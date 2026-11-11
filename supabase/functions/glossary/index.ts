// Edge Function "glossary": define pela IA um termo que não está no glossário próprio do dicionário.
// POST {term} → {entry: GlossaryEntry | null, cached: boolean}. entry null = a IA não reconheceu o termo.
// Cache compartilhado (glossary_ai): termo já consultado volta sem custo e sem exigir acesso à IA.
import { GeminiError, generateJson } from '../../../shared/ai/gemini.ts';
import { GLOSSARY_PROMPT_VERSION, GlossaryAnswer, glossaryAnswerJsonSchema, glossaryPrompt, MAX_TERM_LENGTH } from '../../../shared/ai/glossary.ts';
import { normalizeTerm, type GlossaryEntry } from '../../../shared/glossary/search.ts';
import { defaultModel, keyFor } from '../_shared/ai.ts';
import { adminClient, CORS, json, logUsage, requireUser } from '../_shared/http.ts';

const toEntry = (a: GlossaryAnswer): GlossaryEntry | null => a.found && a.definition.trim()
  ? { term: a.term.trim(), area: a.area.trim() || 'Geral', definition: a.definition.trim(), ...(a.note.trim() ? { note: a.note.trim() } : {}), see: a.see.map((s) => s.trim()).filter(Boolean).slice(0, 3) }
  : null;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
  const auth = await requireUser(req, { ai: false });
  if (auth instanceof Response) return auth;
  const body = await req.json().catch(() => ({}));
  const term = String(body.term ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TERM_LENGTH);
  const key = normalizeTerm(term);
  if (key.length < 2) return json(400, { error: 'Digite o termo que quer consultar.' });

  const admin = adminClient();
  const { data: hit } = await admin.from('glossary_ai').select('entry').eq('term_key', key).eq('prompt_version', GLOSSARY_PROMPT_VERSION).maybeSingle();
  if (hit) return json(200, { entry: hit.entry, cached: true });

  // Termo novo: chamada paga, só para quem tem acesso à IA e dentro do teto diário.
  const gate = await requireUser(req);
  if (gate instanceof Response) return gate;
  const model = defaultModel(), started = Date.now();
  try {
    const r = await generateJson({
      apiKey: keyFor(model), model, schema: GlossaryAnswer, jsonSchema: glossaryAnswerJsonSchema(),
      parts: [{ text: glossaryPrompt(term) }], temperature: 0.1, thinkingLevel: 'low', timeoutMs: 25_000,
    });
    await logUsage(admin, { ownerId: auth.user.id, operation: 'glossary', model, promptVersion: GLOSSARY_PROMPT_VERSION, usage: r.usage, latencyMs: Date.now() - started, status: 'ok' });
    const entry = toEntry(r.data);
    await admin.from('glossary_ai').upsert({ term_key: key, prompt_version: GLOSSARY_PROMPT_VERSION, model, entry }, { onConflict: 'term_key,prompt_version' });
    return json(200, { entry, cached: false });
  } catch (err) {
    await logUsage(admin, { ownerId: auth.user.id, operation: 'glossary', model, promptVersion: GLOSSARY_PROMPT_VERSION, usage: err instanceof GeminiError ? err.usage : null, latencyMs: Date.now() - started, status: 'error', error: err instanceof Error ? err.message : String(err) });
    return json(502, { error: 'A IA não conseguiu responder agora. Tente de novo.', detail: err instanceof Error ? err.message : String(err) });
  }
});
