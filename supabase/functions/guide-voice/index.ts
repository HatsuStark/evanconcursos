// Edge Function "guide-voice": áudio de um trecho da apostila numa voz de IA fixa.
// POST {guideId, section, part, voice} → {url, seconds, cached}. O texto vem sempre da apostila salva, nunca do
// navegador. Cada texto e voz é gerado uma vez e reaproveitado. O acesso segue ALLOWED_EMAILS, como o resto da IA;
// quando houver planos, é aqui que entra a regra do plano que dá direito às vozes.
import { GeminiError, type GeminiUsage } from '../../../shared/ai/gemini.ts';
import { aiVoiceById, guideSpeech, speechParts, TTS_PROMPT_VERSION } from '../../../shared/ai/speech.ts';
import { generateSpeech, wavToMp3 } from '../../../shared/ai/tts.ts';
import { adminClient, CORS, json, logUsage, requireUser } from '../_shared/http.ts';

const BUCKET = 'guide-audio', LINK_SECONDS = 3600;

async function sha256Hex(text: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const body = await req.json().catch(() => ({}));
  const admin = adminClient();
  const model = Deno.env.get('GEMINI_TTS_MODEL') || 'gemini-3.8-flash-lite-tts';
  const started = Date.now();
  let usage: GeminiUsage | null = null;
  const log = (status: 'ok' | 'error', error?: string) => logUsage(admin, { ownerId: auth.user.id, operation: 'guide_voice', model, promptVersion: TTS_PROMPT_VERSION, usage, latencyMs: Date.now() - started, status, error });
  try {
    const voice = aiVoiceById(String(body.voice ?? ''));
    if (!voice) return json(400, { error: 'Voz desconhecida.' });
    const { data: guide } = await auth.client.from('study_guides').select('content').eq('id', String(body.guideId ?? '')).maybeSingle();
    if (!guide) return json(404, { error: 'Apostila não encontrada.' });
    const section = guideSpeech(guide.content).find((s) => s.key === String(body.section ?? ''));
    const text = section && speechParts(section)[Number(body.part)];
    if (!text) return json(404, { error: 'Trecho não encontrado.' });

    const key = await sha256Hex([model, TTS_PROMPT_VERSION, voice.voice, voice.style, text].join('\n'));
    const link = async (path: string) => {
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, LINK_SECONDS);
      if (error || !data) throw new Error(error?.message ?? 'Falha ao criar o link do áudio.');
      return data.signedUrl;
    };
    const { data: saved } = await admin.from('guide_audio').select('storage_path, seconds').eq('cache_key', key).maybeSingle();
    if (saved) return json(200, { url: await link(saved.storage_path), seconds: Number(saved.seconds), cached: true });

    const r = await generateSpeech({ apiKey: Deno.env.get('GEMINI_API_KEY') ?? '', model, voice: voice.voice, style: voice.style, text });
    usage = r.usage;
    const { mp3, seconds } = await wavToMp3(r.wav);
    const path = `${key}.mp3`;
    const up = await admin.storage.from(BUCKET).upload(path, mp3, { contentType: 'audio/mpeg', upsert: true });
    if (up.error) throw new Error(up.error.message);
    const { error } = await admin.from('guide_audio').upsert({ cache_key: key, voice: voice.voice, model, prompt_version: TTS_PROMPT_VERSION, storage_path: path, seconds: Math.round(seconds * 100) / 100, size_bytes: mp3.length });
    if (error) throw new Error(error.message);
    await log('ok');
    return json(200, { url: await link(path), seconds, cached: false });
  } catch (err) {
    if (err instanceof GeminiError && err.usage) usage = err.usage;
    const message = err instanceof Error ? err.message : String(err);
    await log('error', message).catch(() => {});
    return json(502, { error: 'Não foi possível gerar a voz agora.', detail: message.slice(0, 300) });
  }
});
