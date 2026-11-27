// Edge Function "audio-review": revisão em áudio do dia de revisão semanal. POST:
//   {action:'start', taskId, duration, voice} → {review}; cria (ou devolve a equivalente) e começa em segundo plano.
//   {action:'status', taskId} → {review|null, used, limit}; retoma uma geração parada.
//   {action:'links', id} → {blocks:[{index,url}]}; links temporários da narração (revisão pronta).
//   {action:'progress', id, positionMs, listenedMs, music, speed, completed} → {ok}; escuta (sem custo de IA).
//   {action:'quiz', id, answers} → {score, correct}; corrige a miniavaliação no servidor.
//   {action:'retry', id} → {review}; retoma uma geração que falhou de onde parou (o que já foi narrado fica).
//   {action:'work', id} (só do próprio backend, com a chave de serviço) → avança uma etapa ou um bloco.
// Etapas: coleta → plano → roteiro → conferência → narração (blocos em paralelo) → pronta. Cada etapa roda numa chamada,
// com lease no banco: se uma chamada cair, outra retoma depois do lease. A montagem (pausas, trilha, loudness) é feita
// no navegador com os blocos daqui; as versões com e sem música usam a mesma narração.
import { GeminiError, generateJson, type GeminiUsage } from '../../../shared/ai/gemini.ts';
import { guideCacheKey } from '../../../shared/ai/guide.ts';
import { generateSpeech, wavToMp3 } from '../../../shared/ai/tts.ts';
import {
  AUDIO_PIPELINE_VERSION, AUDIO_PROMPT_VERSION, DURATIONS, ERROR_DAYS, GENERATIONS_PER_WEEKLY_TASK, MAX_ERROR_QUESTIONS, MAX_THEMES,
  NARRATOR_STYLE, RECENT_DAYS, TTS_MODEL_DEFAULT, VOICES, WORDS_PER_MINUTE, type Duration, type VoiceKind,
} from '../../../shared/audio/config.ts';
import { buildMaterials, guideText, type ErrorQuestion, type GuideLike } from '../../../shared/audio/materials.ts';
import { selectReview, type ThemeInput } from '../../../shared/audio/priority.ts';
import { planPrompt, quizPrompt, reviewPrompt, scriptPrompt, type PromptContext } from '../../../shared/audio/prompts.ts';
import {
  applyReview, buildBlocks, buildTimeline, chapterGroups, ChapterScripts, checkScript, cleanQuiz, jsonSchemaOf, RetentionQuiz, ReviewPlan, ScriptReview,
  type Block, type QuizQuestion, type ReviewScript,
} from '../../../shared/audio/script.ts';
import { defaultModel, keyFor } from '../_shared/ai.ts';
import { findGuide, resolve } from '../_shared/guides.ts';
import { adminClient, CORS, isAdmin, json, logUsage, modelPrice, requireUser } from '../_shared/http.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };
type Admin = ReturnType<typeof adminClient>;

const BUCKET = 'review-audio', LINK_SECONDS = 4 * 3600;
const LEASE_S = 140, BLOCK_LEASE_S = 90, QUIZ_LEASE_S = 90;
const MAX_ATTEMPTS = 3, PARALLEL_BLOCKS = 3, STALE_MS = 45_000;
const textModel = () => Deno.env.get('AUDIO_MODEL') || defaultModel();
const ttsModel = () => Deno.env.get('GEMINI_TTS_MODEL') || TTS_MODEL_DEFAULT;
const limit = () => { const v = Number(Deno.env.get('AUDIO_GENERATIONS_PER_TASK')); return Number.isFinite(v) && v > 0 ? v : GENERATIONS_PER_WEEKLY_TASK; };
// Quem pode gerar antes do dia da revisão semanal (teste): admin e os e-mails de AUDIO_EARLY_EMAILS.
const earlyAccess = (email: string) => isAdmin(email) || (Deno.env.get('AUDIO_EARLY_EMAILS') ?? '').split(',').map((e) => e.trim().toLowerCase()).includes(email.toLowerCase());
const todaySP = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

async function sha256Hex(text: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Chama a si mesma para a próxima etapa (sem esperar a resposta). A chave de serviço só circula entre o backend e ele.
function kick(id: string) {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/audio-review`;
  EdgeRuntime.waitUntil(fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-worker-key': Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '' },
    body: JSON.stringify({ action: 'work', id }),
  }).then((r) => r.body?.cancel()).catch((e) => console.error('kick:', e)));
}
function isWorker(req: Request) {
  const a = req.headers.get('x-worker-key') ?? '', b = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Coleta: temas do dia de revisão, desempenho real e materiais. Nada de nome, e-mail ou id do aluno vai para a IA.
// ---------------------------------------------------------------------------------------------------------------
interface Collected { ctx: Omit<PromptContext, 'themeIds'> & { themeIds: [string, string][] }; scriptKey: string; summary: { themes: { id: string; title: string; subject: string; bucket: string; minutes: number; reasons: string[] }[]; errors: number; materials: { id: string; kind: string; title: string }[] } }

async function collect(admin: Admin, ownerId: string, task: { id: string; plan_id: string }, duration: Duration): Promise<Collected | null> {
  const today = todaySP();
  const { data: plan } = await admin.from('study_plans').select('notice_id').eq('id', task.plan_id).eq('owner_id', ownerId).single();
  const { data: notice } = await admin.from('notices').select('board, role_name').eq('id', plan!.notice_id).single();
  // Temas: revisões vencidas (as da semana) e teoria concluída nos últimos dias.
  const [{ data: due }, { data: recent }] = await Promise.all([
    admin.from('theory_reviews').select('task_id, session_id, stage, due_on, last_result').eq('owner_id', ownerId).eq('plan_id', task.plan_id)
      .eq('status', 'pending').lte('due_on', today).order('due_on').limit(60),
    admin.from('tasks').select('id, session_id, done_at').eq('owner_id', ownerId).eq('plan_id', task.plan_id).eq('kind', 'theory')
      .not('session_id', 'is', null).gte('done_at', daysAgo(RECENT_DAYS)).limit(60),
  ]);
  const bySession = new Map<string, { taskId: string; stage: number; dueOn: string | null; lastResult: ThemeInput['lastResult'] }>();
  for (const r of due ?? []) bySession.set(r.session_id, { taskId: r.task_id, stage: r.stage, dueOn: r.due_on, lastResult: r.last_result });
  for (const t of recent ?? []) if (!bySession.has(t.session_id!)) bySession.set(t.session_id!, { taskId: t.id, stage: 0, dueOn: null, lastResult: null });
  if (!bySession.size) return null;
  const sessionIds = [...bySession.keys()];
  const [{ data: tasks }, { data: sessions }, { data: attempts }] = await Promise.all([
    admin.from('tasks').select('id, session_id, subject_id, title, done_at').eq('owner_id', ownerId).in('session_id', sessionIds).eq('kind', 'theory').not('done_at', 'is', null),
    admin.from('study_sessions').select('id, title, incidence, subject_id').eq('owner_id', ownerId).in('id', sessionIds),
    admin.from('question_attempts').select('session_id, qid, correct').eq('owner_id', ownerId).eq('plan_id', task.plan_id).in('session_id', sessionIds).limit(5000),
  ]);
  const subjectIds = [...new Set((sessions ?? []).map((s) => s.subject_id))];
  const { data: subjects } = await admin.from('notice_subjects').select('id, name').in('id', subjectIds);
  const subjectName = new Map((subjects ?? []).map((s) => [s.id, s.name as string]));
  const stats = new Map<string, { attempts: number; wrong: number }>();
  for (const a of attempts ?? []) { const s = stats.get(a.session_id!) ?? { attempts: 0, wrong: 0 }; s.attempts++; if (!a.correct) s.wrong++; stats.set(a.session_id!, s); }
  const themes: ThemeInput[] = (sessions ?? []).map((s) => {
    const info = bySession.get(s.id)!, t = (tasks ?? []).find((x) => x.session_id === s.id), st = stats.get(s.id) ?? { attempts: 0, wrong: 0 };
    return {
      id: s.id, title: String(s.title).replace(/\s*\(parte \d+ de \d+\)\s*/i, ' ').trim(), subject: subjectName.get(s.subject_id) ?? '',
      stage: info.stage, dueOn: info.dueOn, lastResult: info.lastResult, studiedOn: t?.done_at ? String(t.done_at).slice(0, 10) : null,
      attempts: st.attempts, wrong: st.wrong, incidence: Number(s.incidence ?? 2),
    };
  });
  // Erros persistentes: caderno de erros do plano, os que voltaram mais vezes.
  const { data: book } = await admin.from('error_book').select('qid, wrong_count, updated_at').eq('owner_id', ownerId).eq('plan_id', task.plan_id)
    .eq('resolved', false).gte('updated_at', daysAgo(ERROR_DAYS)).order('wrong_count', { ascending: false }).limit(40);
  const errQids = (book ?? []).map((b) => b.qid);
  const { data: errAtt } = errQids.length
    ? await admin.from('question_attempts').select('qid, session_id').eq('owner_id', ownerId).eq('plan_id', task.plan_id).eq('correct', false).in('qid', errQids).not('session_id', 'is', null).limit(500)
    : { data: [] };
  const themeOfQ = new Map<string, string>();
  for (const a of errAtt ?? []) if (!themeOfQ.has(a.qid) && bySession.has(a.session_id!)) themeOfQ.set(a.qid, a.session_id!);
  const selection = selectReview(themes.slice(0, 40), (book ?? []).map((b) => ({ qid: b.qid, themeId: themeOfQ.get(b.qid) ?? null, times: b.wrong_count, lastAt: b.updated_at })), duration, today);
  selection.themes = selection.themes.slice(0, MAX_THEMES);
  selection.errors = selection.errors.slice(0, MAX_ERROR_QUESTIONS);

  // Materiais: apostila (revisão curta e completa, as já geradas) e a lei de cada tema; questões erradas; conceitos.
  const themeMats = (await Promise.all(selection.themes.map(async (t) => {
    const tk = (tasks ?? []).find((x) => x.session_id === t.id);
    if (!tk) return null;
    const ctx = await resolve(admin, admin, ownerId, { subject_id: tk.subject_id, session_id: tk.session_id }, 'completa').catch((e) => { console.error('resolve:', e); return null; });
    if (!ctx) return null;
    const rev = { ...ctx, input: { ...ctx.input, depth: 'revisao' as const }, key: guideCacheKey({ ...ctx.input, depth: 'revisao', cargo: ctx.cargo }) };
    const [full, review] = await Promise.all([findGuide(admin, ctx), findGuide(admin, rev)]);
    const text = guideText((review?.content ?? null) as GuideLike | null, (full?.content ?? null) as GuideLike | null);
    if (!text) return null;
    return { id: t.id, title: t.title, minutes: t.minutes, guide: text, law: ctx.input.law, versions: [full?.id, review?.id].filter(Boolean) as string[] };
  }))).filter((x) => x !== null);
  if (!themeMats.length) return null;
  const keep = new Set(themeMats.map((t) => t.id));
  selection.themes = selection.themes.filter((t) => keep.has(t.id));

  const { data: qrows } = selection.errors.length
    ? await admin.from('qbank_questions').select('qid, payload, gabarito, explanation').in('qid', selection.errors.map((e) => e.qid))
    : { data: [] };
  const errors: ErrorQuestion[] = selection.errors.map((e) => {
    const q = (qrows ?? []).find((r) => r.qid === e.qid);
    if (!q) return null;
    const p = q.payload as { enunciado?: string; alternativas?: { letra: string; texto: string }[] };
    return { qid: e.qid, themeId: e.themeId, enunciado: p.enunciado ?? '', alternativas: p.alternativas ?? [], gabarito: q.gabarito, resumo: (q.explanation as { resumo?: string } | null)?.resumo ?? '', times: e.times };
  }).filter((x): x is ErrorQuestion => x !== null && !!x.enunciado);
  const { data: concepts } = await admin.from('tutor_concepts').select('name, essence, task_id, level, lapses').eq('owner_id', ownerId).eq('plan_id', task.plan_id)
    .or('level.eq.atencao,lapses.gt.0').lte('due_on', today).limit(6);

  // Ids curtos para a IA (T1, T2…): o id interno não sai do servidor.
  const themeIds = new Map(selection.themes.map((t, i) => [t.id, `T${i + 1}`]));
  const materials = buildMaterials({
    themes: themeMats.map((t) => ({ ...t, id: themeIds.get(t.id)! })),
    errors: errors.map((e) => ({ ...e, themeId: e.themeId ? themeIds.get(e.themeId) ?? null : null })),
    concepts: (concepts ?? []).map((c) => ({ themeId: null, name: c.name, essence: c.essence })),
  });
  const versions = themeMats.flatMap((t) => t.versions).sort();
  const scriptKey = await sha256Hex(JSON.stringify({
    v: AUDIO_PIPELINE_VERSION, p: AUDIO_PROMPT_VERSION, m: textModel(), duration, versions,
    sel: selection.themes.map((t) => [t.id, t.bucket, t.stage, t.lastResult, t.attempts, t.wrong]), err: selection.errors.map((e) => [e.qid, e.times]),
    mats: await Promise.all(materials.map((m) => sha256Hex(m.text))),
  }));
  return {
    scriptKey,
    ctx: { banca: String(notice?.board ?? ''), cargo: String(notice?.role_name ?? ''), duration, selection, themeIds: [...themeIds.entries()], materials },
    summary: {
      themes: selection.themes.map((t) => ({ id: themeIds.get(t.id)!, title: t.title, subject: t.subject, bucket: t.bucket, minutes: t.minutes, reasons: t.reasons })),
      errors: errors.length, materials: materials.map((m) => ({ id: m.id, kind: m.kind, title: m.title })),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Etapas do worker
// ---------------------------------------------------------------------------------------------------------------
type Review = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Usage = { input: number; output: number; thinking: number; calls: number; retries: number };
const addUsage = (u: Usage | undefined, g: GeminiUsage | null): Usage => ({
  input: (u?.input ?? 0) + (g?.inputTokens ?? 0), output: (u?.output ?? 0) + (g?.outputTokens ?? 0), thinking: (u?.thinking ?? 0) + (g?.thinkingTokens ?? 0),
  calls: (u?.calls ?? 0) + 1, retries: u?.retries ?? 0,
});
const promptCtx = (r: Review): PromptContext => ({ ...r.inputs.ctx, themeIds: new Map(r.inputs.ctx.themeIds) });

async function ai<T>(admin: Admin, r: Review, op: string, prompt: string, schema: Parameters<typeof generateJson>[0]['schema'], timeoutMs = 120_000, thinkingLevel: 'low' | 'medium' = 'low') {
  const model = textModel(), started = Date.now();
  try {
    const res = await generateJson({ apiKey: keyFor(model), model, parts: [{ text: prompt }], schema, jsonSchema: jsonSchemaOf(schema), temperature: 0.4, thinkingLevel, timeoutMs });
    await logUsage(admin, { ownerId: r.owner_id, operation: op, model, promptVersion: AUDIO_PROMPT_VERSION, usage: res.usage, latencyMs: Date.now() - started, status: 'ok' });
    return { data: res.data as T, usage: res.usage };
  } catch (e) {
    await logUsage(admin, { ownerId: r.owner_id, operation: op, model, promptVersion: AUDIO_PROMPT_VERSION, usage: e instanceof GeminiError ? e.usage : null, latencyMs: Date.now() - started, status: 'error', error: (e as Error).message }).catch(() => {});
    throw e;
  }
}

async function stepCollect(admin: Admin, r: Review) {
  const c = await collect(admin, r.owner_id, { id: r.task_id, plan_id: r.plan_id }, r.duration_min);
  if (!c) throw new Fatal('Não há conteúdo estudado com apostila para revisar nesta semana.');
  // Roteiro equivalente já pronto (mesmo conteúdo e duração, outra voz ou outra revisão): só falta narrar.
  const { data: same } = await admin.from('audio_reviews').select('plan, script, timeline, issues, quiz, quiz_status').eq('owner_id', r.owner_id)
    .eq('inputs->>scriptKey', c.scriptKey).not('script', 'is', null).neq('id', r.id).limit(1).maybeSingle();
  if (same?.script) return { inputs: { ...c, reusedScript: true }, plan: same.plan, script: same.script, issues: same.issues, quiz: same.quiz, quiz_status: same.quiz_status === 'done' ? 'done' : 'pending', status: 'validating' };
  return { inputs: c, status: 'planning' };
}

async function stepPlan(admin: Admin, r: Review) {
  const res = await ai<ReviewPlan>(admin, r, 'audio_plan', planPrompt(promptCtx(r)), ReviewPlan, 90_000);
  const ids = new Set(promptCtx(r).materials.map((m) => m.id));
  const plan = { ...res.data, capitulos: res.data.capitulos.filter((c) => c.minutos > 0).map((c) => ({ ...c, referencias: c.referencias.filter((x) => ids.has(x)) })) };
  if (!plan.capitulos.length) throw new Error('Plano sem capítulos.');
  return { plan, usage: { ...r.usage, text: addUsage(r.usage?.text, res.usage) }, status: 'scripting' };
}

// Capítulos em grupos de até ~8 min, escritos em paralelo: cada grupo recebe só os materiais que cita.
async function stepScript(admin: Admin, r: Review) {
  const plan = r.plan as ReviewPlan, ctx = promptCtx(r);
  const groups = chapterGroups(plan.capitulos);
  let usage = r.usage?.text as Usage | undefined;
  const parts = await Promise.all(groups.map(async (g) => {
    const refs = new Set(plan.capitulos.filter((c) => g.includes(c.id)).flatMap((c) => c.referencias));
    const themes = new Set(plan.capitulos.filter((c) => g.includes(c.id)).flatMap((c) => c.temas));
    const mats = ctx.materials.filter((m) => refs.has(m.id) || (m.themeId && themes.has(m.themeId)));
    const res = await ai<{ capitulos: { id: string; segmentos: ReviewScript['capitulos'][number]['segmentos'] }[] }>(admin, r, 'audio_script', scriptPrompt(ctx, plan, g, mats.length ? mats : ctx.materials), ChapterScripts, 130_000);
    usage = addUsage(usage, res.usage);
    return res.data.capitulos;
  }));
  const byId = new Map(parts.flat().map((c) => [c.id, c.segmentos]));
  const script: ReviewScript = {
    versao: AUDIO_PIPELINE_VERSION, titulo: plan.titulo, idioma: 'pt-BR', duracao_alvo_segundos: r.duration_min * 60, objetivos: plan.objetivos,
    capitulos: plan.capitulos.map((c) => ({ id: c.id, titulo: c.titulo, etapa: c.etapa, segmentos: (byId.get(c.id) ?? []).map((s, i) => ({ ...s, id: `${c.id}-${i}` })) })),
  };
  return { script, usage: { ...r.usage, text: usage }, status: 'validating' };
}

// Conferência: regras fixas, depois a IA contra os materiais (corrige só os segmentos com problema), regras de novo.
// Roteiro reprovado não vira áudio. Depois, os blocos de narração entram na fila.
async function stepValidate(admin: Admin, r: Review) {
  const ctx = promptCtx(r), ids = new Set(ctx.materials.map((m) => m.id));
  let script = r.script as ReviewScript, usage = r.usage?.text as Usage | undefined;
  const issues: string[] = [];
  if (!r.inputs.reusedScript) {
    const first = checkScript(script, ids);
    issues.push(...first.issues);
    const res = await ai<ScriptReview>(admin, r, 'audio_review', reviewPrompt(first.script, ctx.materials), ScriptReview, 120_000, 'medium');
    usage = addUsage(usage, res.usage);
    const fixed = applyReview(first.script, res.data);
    if (!fixed) throw new Fatal('O roteiro não passou na conferência de conteúdo.');
    issues.push(...res.data.problemas.map((p) => `${p.gravidade}: ${p.segmento_id} — ${p.motivo}${p.texto_corrigido ? ' (corrigido)' : ' (removido)'}`));
    script = fixed;
  }
  const final = checkScript(script, ids);
  issues.push(...final.issues.filter((i) => !issues.includes(i)));
  if (!final.ok) throw new Fatal(`Roteiro inválido: ${final.issues.join('; ')}`);
  script = final.script;
  const blocks = buildBlocks(script);
  const voice = VOICES[r.voice as VoiceKind], model = ttsModel();
  const rows = await Promise.all(blocks.map(async (b) => ({ review_id: r.id, idx: b.index, text: b.text, cache_key: await sha256Hex([model, AUDIO_PIPELINE_VERSION, voice, NARRATOR_STYLE, b.text].join('\n')) })));
  await admin.from('audio_review_blocks').delete().eq('review_id', r.id);
  const { error } = await admin.from('audio_review_blocks').insert(rows);
  if (error) throw new Error(error.message);
  const meta = blocks.map(({ index, chapterId, pauseAfterMs, music, cue, transition }: Block) => ({ index, chapterId, pauseAfterMs, music, cue, transition }));
  return { script, issues, timeline: { pending: meta, chapters: script.capitulos.map((c) => ({ id: c.id, titulo: c.titulo })) }, usage: { ...r.usage, text: usage }, status: 'narrating', estimate_ms: final.estimateMs };
}

class Fatal extends Error {}

// Uma etapa sequencial (coleta, plano, roteiro, conferência), sob lease.
async function runStep(admin: Admin, id: string) {
  const { data: r } = await admin.rpc('audio_claim_review', { p_id: id, p_seconds: LEASE_S });
  if (!r?.id) return false;
  try {
    const step = r.status === 'queued' ? stepCollect : r.status === 'planning' ? stepPlan : r.status === 'scripting' ? stepScript : stepValidate;
    const { estimate_ms: _e, ...patch } = await step(admin, r) as Record<string, unknown>;
    const { error } = await admin.from('audio_reviews').update({ ...patch, attempts: 0, lease_until: null, error: null, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
    if (patch.status === 'narrating') {
      for (let i = 0; i < PARALLEL_BLOCKS; i++) kick(id);
      if (patch.quiz_status !== 'done') kick(id);
    } else kick(id);
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500), attempts = r.attempts + 1;
    const fatal = e instanceof Fatal || attempts >= MAX_ATTEMPTS;
    console.error('audio step', r.status, msg);
    await admin.from('audio_reviews').update({
      attempts, error: msg, lease_until: fatal ? null : new Date(Date.now() + 5000 * attempts).toISOString(),
      ...(fatal ? { status: 'failed' } : {}), usage: { ...r.usage, text: { ...(r.usage?.text ?? {}), retries: (r.usage?.text?.retries ?? 0) + 1 } }, updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (!fatal) { await sleep(5000 * attempts + 500); kick(id); }
  }
  return true;
}

// Um bloco de narração: reaproveita o mesmo texto já narrado (mesma voz e modelo) ou gera, confere e guarda.
async function runBlock(admin: Admin, r: Review) {
  const { data: b } = await admin.rpc('audio_claim_block', { p_review: r.id, p_seconds: BLOCK_LEASE_S });
  if (!b?.review_id) return false;
  const model = ttsModel(), voice = VOICES[r.voice as VoiceKind], started = Date.now();
  let usage: GeminiUsage | null = null;
  try {
    const { data: cached } = await admin.from('audio_blocks').select('ms').eq('cache_key', b.cache_key).maybeSingle();
    if (cached) {
      await admin.from('audio_review_blocks').update({ status: 'done', ms: cached.ms, reused: true, lease_until: null, error: null }).eq('review_id', r.id).eq('idx', b.idx);
      return true;
    }
    const res = await generateSpeech({ apiKey: Deno.env.get('GEMINI_API_KEY') ?? '', model, voice, style: NARRATOR_STYLE, text: b.text });
    usage = res.usage;
    const { mp3, seconds } = await wavToMp3(res.wav);
    // Fala cortada ou inventada: ritmo muito fora do esperado para o tamanho do texto.
    const words = (b.text.match(/\S+/g) ?? []).length, wpm = words / (seconds / 60);
    if (seconds < 0.5 || wpm < WORDS_PER_MINUTE * 0.45 || wpm > WORDS_PER_MINUTE * 1.9) throw new Error(`narração fora do ritmo esperado (${Math.round(wpm)} palavras/min em ${seconds.toFixed(1)} s)`);
    const path = `${b.cache_key}.mp3`;
    const up = await admin.storage.from(BUCKET).upload(path, mp3, { contentType: 'audio/mpeg', upsert: true });
    if (up.error) throw new Error(up.error.message);
    const ms = Math.round(seconds * 1000);
    await admin.from('audio_blocks').upsert({ cache_key: b.cache_key, voice, model, pipeline_version: AUDIO_PIPELINE_VERSION, storage_path: path, ms, size_bytes: mp3.length });
    await admin.from('audio_review_blocks').update({ status: 'done', ms, lease_until: null, error: null }).eq('review_id', r.id).eq('idx', b.idx);
    await logUsage(admin, { ownerId: r.owner_id, operation: 'audio_tts', model, promptVersion: AUDIO_PIPELINE_VERSION, usage, latencyMs: Date.now() - started, status: 'ok' });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    if (e instanceof GeminiError && e.usage) usage = e.usage;
    await logUsage(admin, { ownerId: r.owner_id, operation: 'audio_tts', model, promptVersion: AUDIO_PIPELINE_VERSION, usage, latencyMs: Date.now() - started, status: 'error', error: msg }).catch(() => {});
    const failed = b.attempts >= MAX_ATTEMPTS;
    await admin.from('audio_review_blocks').update({ error: msg, ...(failed ? { status: 'failed' } : { lease_until: new Date(Date.now() + 4000 * b.attempts).toISOString() }) }).eq('review_id', r.id).eq('idx', b.idx);
    if (failed) await admin.from('audio_reviews').update({ status: 'failed', error: `Narração falhou: ${msg}`, updated_at: new Date().toISOString() }).eq('id', r.id).eq('status', 'narrating');
    else await sleep(4000 * b.attempts + 500);
  }
  await admin.from('audio_reviews').update({ updated_at: new Date().toISOString() }).eq('id', r.id);
  return true;
}

async function runQuiz(admin: Admin, r: Review) {
  const { data: got } = await admin.rpc('audio_claim_quiz', { p_id: r.id, p_seconds: QUIZ_LEASE_S });
  if (!got) return;
  try {
    const ctx = promptCtx(r), script = r.script as ReviewScript;
    const res = await ai<{ questoes: QuizQuestion[] }>(admin, r, 'audio_quiz', quizPrompt(script, ctx.materials), RetentionQuiz, 90_000);
    const asked = script.capitulos.flatMap((c) => c.segmentos).filter((s) => s.efeito === 'recuperacao').map((s) => s.texto);
    const questoes = cleanQuiz(res.data.questoes, asked, new Set(ctx.materials.map((m) => m.id)));
    await admin.from('audio_reviews').update({ quiz: { questoes, usage: addUsage(undefined, res.usage) }, quiz_status: questoes.length ? 'done' : 'failed' }).eq('id', r.id);
    await updateCost(admin, r.id);
  } catch (e) {
    console.error('audio quiz:', e);
    await admin.from('audio_reviews').update({ quiz_status: 'failed' }).eq('id', r.id);
  }
}

// Custo total pelos tokens guardados (texto, narração e miniavaliação) e preços vigentes de ai_model_prices.
async function updateCost(admin: Admin, id: string) {
  const { data: r } = await admin.from('audio_reviews').select('usage, quiz, text_model, tts_model').eq('id', id).single();
  const { data: blocks } = await admin.from('audio_review_blocks').select('ms, reused').eq('review_id', id);
  const [tp, sp] = await Promise.all([modelPrice(admin, r!.text_model), modelPrice(admin, r!.tts_model)]);
  const text = (r!.usage?.text ?? {}) as Partial<Usage>, quiz = (r!.quiz?.usage ?? {}) as Partial<Usage>;
  const narrated = (blocks ?? []).filter((b) => !b.reused).reduce((a, b) => a + (b.ms ?? 0), 0);
  const audioTokens = Math.round(narrated / 1000 * 25); // 25 tokens de áudio por segundo (medido em 2026-11-26)
  const textIn = (text.input ?? 0) + (quiz.input ?? 0), textOut = (text.output ?? 0) + (text.thinking ?? 0) + (quiz.output ?? 0) + (quiz.thinking ?? 0);
  const cost = (tp ? (textIn * tp.inputPerMtokUsd + textOut * tp.outputPerMtokUsd) / 1e6 : 0) + (sp ? audioTokens * sp.outputPerMtokUsd / 1e6 : 0);
  await admin.from('audio_reviews').update({
    cost_usd: Math.round(cost * 10000) / 10000,
    usage: { ...r!.usage, audio: { tokens: audioTokens, narratedMs: narrated, reusedBlocks: (blocks ?? []).filter((b) => b.reused).length, blocks: blocks?.length ?? 0 } },
  }).eq('id', id);
}

async function finalize(admin: Admin, r: Review) {
  const { data: blocks } = await admin.from('audio_review_blocks').select('idx, status, ms').eq('review_id', r.id).order('idx');
  if (!blocks?.length || blocks.some((b) => b.status !== 'done')) return;
  const meta = r.timeline.pending as Parameters<typeof buildTimeline>[0];
  const tl = buildTimeline(meta, blocks.map((b) => b.ms!), r.timeline.chapters);
  const { data: done } = await admin.from('audio_reviews').update({ status: 'ready', timeline: tl, duration_ms: tl.totalMs, ready_at: new Date().toISOString(), updated_at: new Date().toISOString(), error: null })
    .eq('id', r.id).eq('status', 'narrating').select('id');
  if (done?.length) await updateCost(admin, r.id);
}

async function work(admin: Admin, id: string) {
  const { data: r } = await admin.from('audio_reviews').select('*').eq('id', id).maybeSingle();
  if (!r || r.status === 'ready' || r.status === 'failed') return;
  if (r.status !== 'narrating') { await runStep(admin, id); return; }
  if (r.quiz_status === 'pending' || (r.quiz_status === 'running' && Date.parse(r.quiz_lease_until ?? 0) < Date.now())) {
    const { data: q } = await admin.from('audio_reviews').select('quiz_status').eq('id', id).single();
    if (q?.quiz_status !== 'done') await runQuiz(admin, r);
  }
  if (await runBlock(admin, r)) { kick(id); return; }
  await finalize(admin, r);
}

// ---------------------------------------------------------------------------------------------------------------
// API do app
// ---------------------------------------------------------------------------------------------------------------
// O que vai para a tela: sem materiais, sem roteiro inteiro, sem gabarito da miniavaliação.
function publicReview(r: Review) {
  const ready = r.status === 'ready';
  return {
    id: r.id, status: r.status, duration: r.duration_min, voice: r.voice, error: r.status === 'failed' ? 'A geração não terminou. Você pode tentar retomar.' : null,
    title: r.script?.titulo ?? r.plan?.titulo ?? null, themes: r.inputs?.summary?.themes ?? [], errors: r.inputs?.summary?.errors ?? 0,
    timeline: ready ? r.timeline : null, durationMs: r.duration_ms, objectives: r.script?.objetivos ?? r.plan?.objetivos ?? [],
    quiz: r.quiz_status === 'done' ? (r.quiz?.questoes ?? []).map((q: QuizQuestion) => ({ enunciado: q.enunciado, alternativas: q.alternativas })) : null,
    quizStatus: r.quiz_status, quizResult: r.quiz_done_at ? { score: r.quiz_score, answers: r.quiz_answers } : null,
    positionMs: r.position_ms, maxPositionMs: r.max_position_ms, completed: !!r.completed_at, music: r.music, speed: r.speed,
    createdAt: r.created_at,
  };
}

// Só no dia da revisão semanal (ou depois, com a semana aberta). Admin e AUDIO_EARLY_EMAILS podem gerar antes.
async function weeklyTask(client: ReturnType<typeof adminClient>, taskId: string, early: boolean) {
  const { data } = await client.from('tasks').select('id, plan_id, kind, date, superseded_in_version').eq('id', taskId).maybeSingle();
  if (!data || data.kind !== 'weekly_review' || data.superseded_in_version) return null;
  return String(data.date) <= todaySP() || early ? data : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
  const body = await req.json().catch(() => ({}));
  const admin = adminClient();

  if (body.action === 'work') {
    if (!isWorker(req)) return json(403, { error: 'Proibido.' });
    EdgeRuntime.waitUntil(work(admin, String(body.id ?? '')).catch((e) => console.error('audio work:', e)));
    return json(202, { ok: true });
  }

  // Escuta, links e status não gastam IA; gerar e retomar seguem ALLOWED_EMAILS e o teto diário.
  const costly = body.action === 'start' || body.action === 'retry';
  const auth = await requireUser(req, { ai: costly });
  if (auth instanceof Response) return auth;
  const ownerId = auth.user.id;
  const own = async (id: string) => (await admin.from('audio_reviews').select('*').eq('id', id).eq('owner_id', ownerId).maybeSingle()).data as Review | null;

  try {
    if (body.action === 'status') {
      const { data: rows } = await admin.from('audio_reviews').select('*').eq('owner_id', ownerId).eq('task_id', String(body.taskId ?? '')).order('created_at', { ascending: false }).limit(5);
      const r = rows?.[0] as Review | undefined;
      // Parada (chamada caiu e ninguém retomou): retoma.
      if (r && !['ready', 'failed'].includes(r.status) && Date.now() - Date.parse(r.updated_at) > STALE_MS) kick(r.id);
      // Progresso real da narração: blocos prontos de quantos.
      let blocks: { done: number; total: number } | null = null;
      if (r?.status === 'narrating') {
        const { data: bs } = await admin.from('audio_review_blocks').select('status').eq('review_id', r.id);
        blocks = { done: (bs ?? []).filter((b) => b.status === 'done').length, total: bs?.length ?? 0 };
      }
      const { data: t } = await auth.client.from('tasks').select('kind, date').eq('id', String(body.taskId ?? '')).maybeSingle();
      const due = !!t && t.kind === 'weekly_review' && String(t.date) <= todaySP();
      const early = !due && !!t && t.kind === 'weekly_review' && earlyAccess(auth.user.email ?? '');
      return json(200, { review: r ? { ...publicReview(r), blocks } : null, used: (rows ?? []).filter((x) => x.status !== 'failed').length, limit: limit(), available: due || early, early, date: t?.date ?? null });
    }

    if (body.action === 'start') {
      const task = await weeklyTask(auth.client, String(body.taskId ?? ''), earlyAccess(auth.user.email ?? ''));
      if (!task) return json(400, { error: 'A revisão em áudio fica disponível no dia da revisão semanal.' });
      const duration = (DURATIONS as readonly number[]).includes(Number(body.duration)) ? Number(body.duration) as Duration : 20;
      const voice: VoiceKind = body.voice === 'masculina' ? 'masculina' : 'feminina';
      // A chave final depende do conteúdo (coletado pelo worker); aqui, a da configuração. Mesma configuração = mesma revisão.
      const key = await sha256Hex([AUDIO_PIPELINE_VERSION, AUDIO_PROMPT_VERSION, textModel(), ttsModel(), task.id, duration, voice].join('|'));
      const { data: rows } = await admin.from('audio_reviews').select('*').eq('owner_id', ownerId).eq('task_id', task.id);
      const same = (rows ?? []).find((x) => x.cache_key === key);
      if (same && same.status !== 'failed') return json(200, { review: publicReview(same) });
      if (same) return json(200, { review: publicReview(await retry(admin, same)) });
      if ((rows ?? []).filter((x) => x.status !== 'failed').length >= limit()) {
        return json(403, { error: 'Você já gerou a revisão em áudio desta semana.', code: 'limit' });
      }
      const { data: created, error } = await admin.from('audio_reviews').insert({
        owner_id: ownerId, plan_id: task.plan_id, task_id: task.id, cache_key: key, duration_min: duration, voice,
        pipeline_version: AUDIO_PIPELINE_VERSION, prompt_version: AUDIO_PROMPT_VERSION, text_model: textModel(), tts_model: ttsModel(),
      }).select('*').single();
      if (error) {
        // Corrida (dois cliques): devolve a que entrou.
        const { data: dup } = await admin.from('audio_reviews').select('*').eq('owner_id', ownerId).eq('task_id', task.id).eq('cache_key', key).maybeSingle();
        if (dup) return json(200, { review: publicReview(dup) });
        throw new Error(error.message);
      }
      kick(created.id);
      return json(200, { review: publicReview(created) });
    }

    const r = await own(String(body.id ?? ''));
    if (!r) return json(404, { error: 'Revisão não encontrada.' });

    if (body.action === 'retry') {
      if (r.status !== 'failed') return json(200, { review: publicReview(r) });
      return json(200, { review: publicReview(await retry(admin, r)) });
    }

    if (body.action === 'links') {
      if (r.status !== 'ready') return json(409, { error: 'A revisão ainda não está pronta.' });
      const { data: blocks } = await admin.from('audio_review_blocks').select('idx, cache_key').eq('review_id', r.id).order('idx');
      const { data: files } = await admin.from('audio_blocks').select('cache_key, storage_path').in('cache_key', (blocks ?? []).map((b) => b.cache_key));
      const pathOf = new Map((files ?? []).map((f) => [f.cache_key, f.storage_path]));
      const paths = (blocks ?? []).map((b) => pathOf.get(b.cache_key)!);
      const { data: signed, error } = await admin.storage.from(BUCKET).createSignedUrls(paths, LINK_SECONDS);
      if (error || !signed) throw new Error(error?.message ?? 'Falha ao criar os links.');
      return json(200, { blocks: (blocks ?? []).map((b, i) => ({ index: b.idx, url: signed[i]!.signedUrl })) });
    }

    if (body.action === 'progress') {
      const pos = Math.max(0, Math.min(Number(body.positionMs) || 0, r.duration_ms ?? 0));
      const listened = Math.max(r.listened_ms, Math.min(Number(body.listenedMs) || 0, (r.duration_ms ?? 0) * 3));
      const completed = !!body.completed || (r.duration_ms && Math.max(r.max_position_ms, pos) >= r.duration_ms * 0.95);
      await admin.from('audio_reviews').update({
        position_ms: Math.round(pos), max_position_ms: Math.round(Math.max(r.max_position_ms, pos)), listened_ms: Math.round(listened),
        ...(typeof body.music === 'boolean' ? { music: body.music } : {}), ...(Number(body.speed) >= 0.5 && Number(body.speed) <= 2 ? { speed: Number(body.speed) } : {}),
        ...(completed && !r.completed_at ? { completed_at: new Date().toISOString() } : {}),
      }).eq('id', r.id);
      return json(200, { ok: true });
    }

    if (body.action === 'quiz') {
      const qs = (r.quiz?.questoes ?? []) as QuizQuestion[];
      if (!qs.length) return json(409, { error: 'A miniavaliação não está disponível.' });
      if (r.quiz_done_at) return json(200, { score: r.quiz_score, total: qs.length, correct: qs.map((q) => q.correta), comments: qs.map((q) => q.comentario), answers: r.quiz_answers });
      const answers = (Array.isArray(body.answers) ? body.answers : []).slice(0, qs.length).map((a: unknown) => (Number.isInteger(a) ? Number(a) : -1));
      const score = qs.reduce((s, q, i) => s + (answers[i] === q.correta ? 1 : 0), 0);
      await admin.from('audio_reviews').update({ quiz_answers: answers, quiz_score: score, quiz_done_at: new Date().toISOString() }).eq('id', r.id);
      return json(200, { score, total: qs.length, correct: qs.map((q) => q.correta), comments: qs.map((q) => q.comentario), answers });
    }

    return json(400, { error: 'Ação desconhecida.' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json(502, { error: 'Não foi possível concluir agora.', detail: message.slice(0, 300) });
  }
});

// Retoma do ponto em que parou: etapa sequencial volta a ser tentada; blocos que falharam voltam para a fila.
async function retry(admin: Admin, r: Review): Promise<Review> {
  const back = r.timeline?.pending ? 'narrating' : r.script ? 'validating' : r.plan ? 'scripting' : r.inputs ? 'planning' : 'queued';
  await admin.from('audio_review_blocks').update({ status: 'pending', attempts: 0, lease_until: null }).eq('review_id', r.id).eq('status', 'failed');
  const { data } = await admin.from('audio_reviews').update({ status: back, attempts: 0, lease_until: null, error: null, updated_at: new Date().toISOString(), ...(r.quiz_status === 'failed' ? { quiz_status: 'pending' } : {}) })
    .eq('id', r.id).select('*').single();
  if (back === 'narrating') for (let i = 0; i < PARALLEL_BLOCKS; i++) kick(r.id);
  else kick(r.id);
  return data as Review;
}
