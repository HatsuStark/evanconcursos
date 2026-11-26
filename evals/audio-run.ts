// Avaliação real da revisão em áudio, fora do app: apostilas reais do banco → plano → roteiro → conferência →
// miniavaliação; com --tts, narra os blocos e monta as versões com e sem trilha em MP3 para ouvir.
// Uso: npx tsx evals/audio-run.ts <pasta-de-saída> <busca-no-título-da-revisão> [minutos=3] [--tts] [--voz=feminina|masculina] [--trilha=arquivo.wav]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { createMp3Encoder } from 'wasm-media-encoders';
import { costUsd, generateJson, type GeminiUsage } from '../shared/ai/gemini.ts';
import { generateSpeech, wavToSamples } from '../shared/ai/tts.ts';
import { NARRATOR_STYLE, TTS_MODEL_DEFAULT, VOICES } from '../shared/audio/config.ts';
import { buildMaterials, guideText, type GuideLike } from '../shared/audio/materials.ts';
import { checkMix, renderMix } from '../shared/audio/mix.ts';
import { readStereoWav } from '../shared/audio/wav.ts';
import { selectReview, type ThemeInput } from '../shared/audio/priority.ts';
import { planPrompt, quizPrompt, reviewPrompt, scriptPrompt, type PromptContext } from '../shared/audio/prompts.ts';
import { applyReview, buildBlocks, buildTimeline, chapterGroups, ChapterScripts, checkScript, cleanQuiz, jsonSchemaOf, RetentionQuiz, ReviewPlan, ScriptReview, type ReviewScript } from '../shared/audio/script.ts';

const root = new URL('..', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('.env', root), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const [out, search] = process.argv.slice(2);
if (!out || !search) { console.error('Uso: npx tsx evals/audio-run.ts <pasta> <busca> [minutos] [--tts]'); process.exit(1); }
const minutes = Number(process.argv[4]) > 0 ? Number(process.argv[4]) : 3;
const tts = process.argv.includes('--tts');
const voiceKind = (process.argv.find((a) => a.startsWith('--voz='))?.slice(6) ?? 'feminina') as keyof typeof VOICES;
const musicFile = process.argv.find((a) => a.startsWith('--trilha='))?.slice(9);
const model = env.AUDIO_MODEL || env.GEMINI_MODEL || 'gemini-3.8-flash';
const PRICE = { input: 0.75, output: 3.75 }, TTS_OUT = 9; // US$/M tokens (doc, 2026-11-26)
mkdirSync(out, { recursive: true });

const url = new URL(readFileSync(new URL('supabase/.temp/pooler-url', root), 'utf8').trim()); url.password = encodeURIComponent(env.SUPABASE_DB_PASSWORD!);
const db = new pg.Client({ connectionString: url.href, ssl: { rejectUnauthorized: false } }); await db.connect();
const { rows } = await db.query(`select id, title, subject_name, depth, content from public.study_guides where depth in ('revisao', 'completa') and title ilike $1 order by depth desc, created_at desc limit 4`, [`%${search}%`]);
await db.end();
if (!rows.length) { console.error('Nenhuma apostila com esse título.'); process.exit(1); }
const review = rows.find((r) => r.depth === 'revisao'), full = rows.find((r) => r.depth === 'completa');
const title = (review ?? full).title as string, subject = (review ?? full).subject_name as string;
console.log(`Tema: ${title} (${subject}) · revisão: ${review ? 'sim' : 'não'} · completa: ${full ? 'sim' : 'não'} · ${minutes} min`);

const today = new Date().toISOString().slice(0, 10);
const theme: ThemeInput = { id: 's1', title, subject, stage: 1, dueOn: today, studiedOn: today, lastResult: null, attempts: 0, wrong: 0, incidence: 2 };
const selection = selectReview([theme], [], minutes, today);
const materials = buildMaterials({ themes: [{ id: 'T1', title, minutes: selection.themes[0]!.minutes, guide: guideText(review?.content as GuideLike ?? null, full?.content as GuideLike ?? null), law: [] }], errors: [], concepts: [] });
const ctx: PromptContext = { banca: 'VUNESP', cargo: '', duration: minutes, selection, themeIds: new Map([['s1', 'T1']]), materials };
const ids = new Set(materials.map((m) => m.id));

const usage: GeminiUsage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };
async function ask<T>(label: string, prompt: string, schema: Parameters<typeof generateJson>[0]['schema'], thinkingLevel: 'low' | 'medium' = 'low') {
  const t = Date.now();
  const r = await generateJson({ apiKey: env.GEMINI_API_KEY!, model, parts: [{ text: prompt }], schema, jsonSchema: jsonSchemaOf(schema), temperature: 0.4, thinkingLevel, timeoutMs: 180_000 });
  usage.inputTokens += r.usage.inputTokens; usage.outputTokens += r.usage.outputTokens; usage.thinkingTokens += r.usage.thinkingTokens;
  console.log(`${label}: ${((Date.now() - t) / 1000).toFixed(1)} s · ${r.usage.inputTokens} in / ${r.usage.outputTokens + r.usage.thinkingTokens} out`);
  return r.data as T;
}

const plan = await ask<ReviewPlan>('plano', planPrompt(ctx), ReviewPlan);
const parts = await Promise.all(chapterGroups(plan.capitulos).map((g, i) => ask<{ capitulos: { id: string; segmentos: ReviewScript['capitulos'][number]['segmentos'] }[] }>(`roteiro ${i + 1}`, scriptPrompt(ctx, plan, g, materials), ChapterScripts)));
const byId = new Map(parts.flatMap((p) => p.capitulos).map((c) => [c.id, c.segmentos]));
let script: ReviewScript = { versao: 'eval', titulo: plan.titulo, idioma: 'pt-BR', duracao_alvo_segundos: minutes * 60, objetivos: plan.objetivos,
  capitulos: plan.capitulos.map((c) => ({ id: c.id, titulo: c.titulo, etapa: c.etapa, segmentos: (byId.get(c.id) ?? []).map((s, i) => ({ ...s, id: `${c.id}-${i}` })) })) };
const first = checkScript(script, ids);
const rv = await ask<ScriptReview>('conferência', reviewPrompt(first.script, materials), ScriptReview, 'medium');
const fixed = applyReview(first.script, rv);
if (!fixed) { console.error('Roteiro reprovado na conferência.'); process.exit(1); }
const final = checkScript(fixed, ids);
script = final.script;
const quizRaw = await ask<{ questoes: Parameters<typeof cleanQuiz>[0] }>('miniavaliação', quizPrompt(script, materials), RetentionQuiz);
const asked = script.capitulos.flatMap((c) => c.segmentos).filter((s) => s.efeito === 'recuperacao').map((s) => s.texto);
const quiz = cleanQuiz(quizRaw.questoes, asked, ids);

console.log(`\nConferência: ${rv.problemas.length} problemas (${rv.problemas.filter((p) => p.gravidade === 'grave').length} graves) · regras: ${[...first.issues, ...final.issues].length} avisos · ok: ${final.ok}`);
for (const p of rv.problemas) console.log(`  - ${p.gravidade} ${p.segmento_id}: ${p.motivo}`);
console.log(`Perguntas de recuperação: ${final.questions} · estimativa ${(final.estimateMs / 60000).toFixed(1)} min · miniavaliação: ${quiz.length} questões`);
console.log(`Custo do texto: US$ ${costUsd(usage, { inputPerMtokUsd: PRICE.input, outputPerMtokUsd: PRICE.output }).toFixed(4)}`);
writeFileSync(join(out, 'roteiro.json'), JSON.stringify({ plan, script, issues: [...first.issues, ...final.issues], review: rv, quiz }, null, 2));
writeFileSync(join(out, 'roteiro.txt'), script.capitulos.map((c) => `## ${c.titulo} [${c.etapa}]\n${c.segmentos.map((s) => `[${s.tipo}${s.formato !== 'nenhum' ? '/' + s.formato : ''} · pausa ${s.pausa_apos_ms / 1000}s] ${s.texto}`).join('\n')}`).join('\n\n'));

if (tts) {
  const blocks = buildBlocks(script), voice = VOICES[voiceKind], ttsModel = env.GEMINI_TTS_MODEL || TTS_MODEL_DEFAULT;
  const t = Date.now();
  let audioTokens = 0, next = 0;
  const voices: Float32Array[] = new Array(blocks.length);
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < blocks.length) {
      const i = next++;
      const r = await generateSpeech({ apiKey: env.GEMINI_API_KEY!, model: ttsModel, voice, style: NARRATOR_STYLE, text: blocks[i]!.text });
      audioTokens += r.usage.outputTokens;
      const { samples, sampleRate } = wavToSamples(r.wav);
      if (sampleRate !== 24000) throw new Error(`taxa inesperada ${sampleRate}`);
      voices[i] = samples;
    }
  }));
  console.log(`\nNarração: ${blocks.length} blocos em ${((Date.now() - t) / 1000).toFixed(0)} s · ${audioTokens} tokens de áudio · US$ ${(audioTokens * TTS_OUT / 1e6).toFixed(4)}`);
  const tl = buildTimeline(blocks, voices.map((v) => (v.length / 24000) * 1000), script.capitulos.map((c) => ({ id: c.id, titulo: c.titulo })));
  const music = musicFile ? readStereoWav(readFileSync(musicFile), 24000) : null;
  for (const withMusic of music ? [true, false] : [false]) {
    const chs = withMusic ? 2 : 1, enc = await createMp3Encoder();
    enc.configure({ sampleRate: 24000, channels: chs, bitrate: withMusic ? 128 : 64 });
    const parts: Uint8Array[] = [];
    const t2 = Date.now();
    const rep = await renderMix({ timeline: tl, sampleRate: 24000, music: withMusic ? music : null, getBlock: async (i) => voices[i]!.slice(), onChunk: (c) => { parts.push(enc.encode(c).slice()); } });
    parts.push(enc.finalize().slice());
    const file = join(out, `revisao-${withMusic ? 'com' : 'sem'}-trilha.mp3`);
    writeFileSync(file, Buffer.concat(parts));
    console.log(`${file}: ${(tl.totalMs / 1000).toFixed(0)} s · ${rep.lufs.toFixed(1)} LUFS · pico ${rep.peakDb.toFixed(1)} dB · montagem ${((Date.now() - t2) / 1000).toFixed(1)} s · ${checkMix(rep).join('; ') || 'conferência ok'}`);
  }
  console.log('Capítulos:', tl.chapters.map((c) => `${(c.startMs / 1000).toFixed(0)}s ${c.titulo}`).join(' · '));
}
