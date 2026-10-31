// Edge Function "study-guide": apostila da sessão gerada pela IA, baseada só no conteúdo do edital e nos
// artigos oficiais da lei seca, sempre em segundo plano (leva cerca de 35 s e não depende da tela aberta). POST:
//   {taskId, depth:'completa'|'revisao'} → 200 {guide} se já existe; senão começa a gerar e responde 202 {pending}.
//   {taskId, depth, poll:true} → como acima, mas não começa nada: 502 se a geração falhou.
//   {action:'prepare', planId} → 202; prepara as apostilas completas das próximas sessões (ver PREPARE_*).
// Reaproveita apostilas idênticas (mesmo tema, fontes e profundidade) entre sessões e estudantes.
// Não há "gerar de novo" pelo estudante (economia de créditos): uma apostila existente é sempre reaproveitada.
import { GeminiError, generateJson, type GeminiUsage } from '../../../shared/ai/gemini.ts';
import { applyBoardEvidence, BOARD_SAMPLE_MAX, boardSample, Guide, GUIDE_PROMPT_VERSION, guideCacheKey, guideJsonSchema, guidePrompt, lawKeys, pickSimilarGuide, topicKeys, unlistedLaws, verifyGuide, type BoardQuestion, type GuideDepth } from '../../../shared/ai/guide.ts';
import { normalizeText } from '../../../shared/ai/notice.ts';
import { QuestClient } from '../../../shared/qbank/client.ts';
import { QMAP_PROMPT_VERSION } from '../../../shared/qbank/map.ts';
import { adminClient, CORS, json, logUsage, requireUser } from '../_shared/http.ts';
import { loadLawSources } from '../_shared/law.ts';
import { cacheQuestions, ensureSessionMap, ensureSubjectMap, mapDeps, plain, publicQuestion, type PublicQuestion } from '../_shared/qbank.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const STUCK_MS = 3 * 60 * 1000; // geração interrompida: libera nova tentativa
// Por chamada, cabe no limite de tempo da função (150 s). Horizonte curto: a sessão quase certamente será estudada.
const PREPARE_DAYS = 3, PREPARE_MAX = 2;
const PREPARE_RETRY_MS = 24 * 3600 * 1000; // apostila que falhou não gasta de novo sem o estudante pedir

type Auth = Exclude<Awaited<ReturnType<typeof requireUser>>, Response>;
type Admin = ReturnType<typeof adminClient>;

// Tudo o que define a apostila de uma tarefa; null se a tarefa não tem sessão de conteúdo.
async function resolve(auth: Auth, admin: Admin, task: { subject_id: string | null; session_id: string | null }, depth: GuideDepth) {
  if (!task.session_id || !task.subject_id) return null;
  const [{ data: session }, { data: subject }] = await Promise.all([
    auth.client.from('study_sessions').select('title, keyword, topic_ids').eq('id', task.session_id).single(),
    auth.client.from('notice_subjects').select('name, notice_id').eq('id', task.subject_id).single(),
  ]);
  const { data: notice } = await auth.client.from('notices').select('board, role_name').eq('id', subject!.notice_id).single();
  const { data: tt } = session?.topic_ids?.length ? await auth.client.from('notice_topics').select('id, text').in('id', session.topic_ids) : { data: [] };
  const topics = (tt ?? []).sort((a, b) => session!.topic_ids.indexOf(a.id) - session!.topic_ids.indexOf(b.id)).map((t) => t.text);
  const { articles, law } = await loadLawSources(admin, { title: session!.title, topics, subject: subject!.name });
  const input = { depth, banca: notice?.board ?? '', subject: subject!.name, title: session!.title, topics, law };
  return {
    input, key: guideCacheKey(input), articles, noticeId: subject!.notice_id as string, cargo: (notice?.role_name ?? '') as string,
    sessionId: task.session_id, subjectId: task.subject_id, keyword: (session?.keyword ?? '') as string,
  };
}
type GuideContext = NonNullable<Awaited<ReturnType<typeof resolve>>>;

// 1) Apostila igual (mesmo conteúdo); 2) semelhante (mesma matéria/banca/profundidade, mesmos artigos,
// tópicos e título parecidos), de qualquer sessão ou estudante. Só gera com a IA quando não há nenhuma.
async function findGuide(admin: Admin, { input, key }: GuideContext) {
  const { data: cached } = await admin.from('study_guides').select('*').eq('cache_key', key).maybeSingle();
  if (cached) return cached;
  const { data: similar } = await admin.from('study_guides').select('*').eq('subject_key', normalizeText(input.subject)).eq('depth', input.depth)
    .eq('banca', normalizeText(input.banca)).eq('prompt_version', GUIDE_PROMPT_VERSION).order('created_at', { ascending: false }).limit(60);
  const hit = pickSimilarGuide({ title: input.title, topics: topicKeys(input.topics), law: lawKeys(input.law) }, similar ?? []);
  return hit >= 0 ? similar![hit] : null;
}

const lastJob = async (admin: Admin, key: string) => (await admin.from('ai_jobs').select('status, started_at').eq('kind', 'study_guide').eq('input->>cacheKey', key)
  .order('created_at', { ascending: false }).limit(1).maybeSingle()).data;
const isRunning = (job: { status: string; started_at: string | null } | null) => job?.status === 'running' && Date.now() - new Date(job.started_at ?? 0).getTime() < STUCK_MS;

// Trava a geração: o índice único de ai_jobs garante uma por apostila. null se já há outra em andamento.
async function claim(admin: Admin, ownerId: string, ctx: GuideContext, source: 'estudante' | 'preparo') {
  await admin.from('ai_jobs').update({ status: 'failed', finished_at: new Date().toISOString(), error: 'Geração interrompida.' })
    .eq('kind', 'study_guide').eq('status', 'running').eq('input->>cacheKey', ctx.key).lt('started_at', new Date(Date.now() - STUCK_MS).toISOString());
  const { data, error } = await admin.from('ai_jobs').insert({
    owner_id: ownerId, kind: 'study_guide', status: 'running', started_at: new Date().toISOString(),
    input: { cacheKey: ctx.key, noticeId: ctx.noticeId, depth: ctx.input.depth, source },
  }).select('id').single();
  if (error?.code === '23505') return null;
  if (error) throw new Error(error.message);
  return data!.id as string;
}

// Questões reais da banca nos assuntos da sessão: primeiro as já guardadas; faltando, busca (6 créditos por questão, uma
// vez, e elas ficam guardadas). Qualquer falha aqui só tira o perfil da banca: a apostila sai do mesmo jeito.
async function boardEvidence(admin: Admin, ownerId: string, ctx: GuideContext): Promise<BoardQuestion[]> {
  const { input } = ctx;
  if (!input.banca) return [];
  const quest = new QuestClient(Deno.env.get('QUEST_API_KEY') ?? '');
  const usage: GeminiUsage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 }, started = Date.now();
  const deps = mapDeps(admin, quest, usage);
  try {
    const sm = await ensureSubjectMap(admin, quest, deps, ownerId, ctx.subjectId, async () => {
      const { data: all } = await admin.from('notice_topics').select('text, position').eq('subject_id', ctx.subjectId).order('position');
      return { name: input.subject, board: input.banca, topics: (all ?? []).map((t) => t.text) };
    });
    const filter = await ensureSessionMap(admin, deps, ownerId, ctx.sessionId, sm.materia, async () => ({ subject: input.subject, title: input.title, keyword: ctx.keyword, topics: input.topics }));
    // Atualidades envelhece rápido, e sem banca identificada não há o que observar.
    if (!sm.banca || !filter.materia || !filter.assuntos.length || /atualidade/i.test(filter.materia)) return [];
    const { data: cached } = await admin.from('qbank_questions').select('payload').eq('materia', filter.materia).in('assunto', filter.assuntos).limit(300);
    const found = (cached ?? []).map((c) => c.payload as PublicQuestion).filter((q) => normalizeText(q.prova?.banca ?? '') === normalizeText(sm.banca));
    const perAssunto = Math.ceil(BOARD_SAMPLE_MAX / filter.assuntos.length);
    for (const assunto of filter.assuntos) {
      if (found.length >= BOARD_SAMPLE_MAX) break;
      const missing = perAssunto - found.filter((q) => q.assunto === assunto).length;
      if (missing <= 0) continue;
      const r = await quest.questoes({ banca: sm.banca, materia: filter.materia, assunto }, Math.min(missing, BOARD_SAMPLE_MAX - found.length));
      await cacheQuestions(admin, r.items);
      for (const q of r.items.map(publicQuestion)) if (!found.some((f) => f.qid === q.qid)) found.push(q);
    }
    await logUsage(admin, { ownerId, operation: 'qbank_fetch', model: usage.inputTokens ? (Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash') : 'quest-api', promptVersion: QMAP_PROMPT_VERSION, usage: usage.inputTokens ? usage : null, latencyMs: Date.now() - started, status: 'ok', credits: quest.credits });
    return boardSample(found.map((q) => ({ assunto: q.assunto, ano: q.prova?.ano, enunciado: plain(q.enunciado), alternativas: q.alternativas.map((a) => `${a.letra}) ${plain(a.texto)}`) })));
  } catch (err) {
    console.error('boardEvidence:', err);
    return [];
  }
}

async function generate(admin: Admin, ownerId: string, jobId: string, ctx: GuideContext) {
  const { input, key, articles, cargo } = ctx;
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash', started = Date.now();
  let usage: GeminiUsage | null = null;
  try {
    const boardQuestions = await boardEvidence(admin, ownerId, ctx);
    const r = await generateJson({ apiKey: Deno.env.get('GEMINI_API_KEY') ?? '', model, schema: Guide, jsonSchema: guideJsonSchema(), temperature: 0.3,
      parts: [{ text: guidePrompt({ ...input, cargo, boardQuestions }) }] });
    usage = r.usage;
    const v = verifyGuide(applyBoardEvidence(r.data, input.banca, boardQuestions.length), articles, input.subject);
    const { error } = await admin.from('study_guides').upsert({
      cache_key: key, depth: input.depth, subject_name: input.subject, subject_key: normalizeText(input.subject), banca: normalizeText(input.banca), topic_keys: topicKeys(input.topics),
      title: input.title, content: v.guide, sources: input.law.map((l) => l.ref), unlisted_sources: unlistedLaws([input.title, ...input.topics].join('\n')), unverified: v.unverified,
      model, prompt_version: GUIDE_PROMPT_VERSION, created_at: new Date().toISOString(),
    }, { onConflict: 'cache_key' });
    if (error) throw new Error(error.message);
    await admin.from('ai_jobs').update({ status: 'succeeded', finished_at: new Date().toISOString() }).eq('id', jobId);
    await logUsage(admin, { ownerId, jobId, operation: 'study_guide', model, promptVersion: GUIDE_PROMPT_VERSION, usage, latencyMs: Date.now() - started, status: 'ok' });
  } catch (err) {
    if (err instanceof GeminiError) usage = err.usage;
    const message = err instanceof Error ? err.message : String(err);
    await admin.from('ai_jobs').update({ status: 'failed', finished_at: new Date().toISOString(), error: message.slice(0, 1000) }).eq('id', jobId);
    await logUsage(admin, { ownerId, jobId, operation: 'study_guide', model, promptVersion: GUIDE_PROMPT_VERSION, usage, latencyMs: Date.now() - started, status: 'error', error: message }).catch(() => {});
  }
}

// Uma de cada vez e na ordem do cronograma. O que já existe não conta no limite.
async function prepare(auth: Auth, admin: Admin, planId: string) {
  const from = new Date().toISOString().slice(0, 10), to = new Date(Date.now() + PREPARE_DAYS * 864e5).toISOString().slice(0, 10);
  const { data: tasks } = await auth.client.from('tasks').select('subject_id, session_id').eq('plan_id', planId).is('superseded_in_version', null).is('done_at', null)
    .not('session_id', 'is', null).gte('date', from).lte('date', to).order('date').order('position').limit(20);
  const seen = new Set<string | null>();
  let made = 0;
  for (const task of tasks ?? []) {
    if (made >= PREPARE_MAX) break;
    if (seen.has(task.session_id)) continue;
    seen.add(task.session_id);
    const ctx = await resolve(auth, admin, task, 'completa');
    if (!ctx || await findGuide(admin, ctx)) continue;
    const job = await lastJob(admin, ctx.key);
    const { data: failed } = await admin.from('ai_jobs').select('id').eq('kind', 'study_guide').eq('status', 'failed').eq('input->>cacheKey', ctx.key)
      .gte('created_at', new Date(Date.now() - PREPARE_RETRY_MS).toISOString()).limit(1);
    if (isRunning(job) || failed?.length) continue;
    const jobId = await claim(admin, auth.user.id, ctx, 'preparo');
    if (!jobId) continue;
    await generate(admin, auth.user.id, jobId, ctx);
    made++;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const body = await req.json().catch(() => ({}));
  const admin = adminClient();
  try {
    if (body.action === 'prepare') {
      EdgeRuntime.waitUntil(prepare(auth, admin, String(body.planId ?? '')).catch((e) => console.error('prepare:', e)));
      return json(202, { ok: true });
    }
    const depth: GuideDepth = body.depth === 'revisao' ? 'revisao' : 'completa';
    const { data: task } = await auth.client.from('tasks').select('subject_id, session_id').eq('id', String(body.taskId ?? '')).maybeSingle();
    const ctx = task && await resolve(auth, admin, task, depth);
    if (!ctx) return json(400, { error: 'A apostila é gerada para tarefas de teoria (com sessão de conteúdo).' });
    const guide = await findGuide(admin, ctx);
    if (guide) return json(200, { guide });
    if (body.poll) {
      const job = await lastJob(admin, ctx.key);
      if (!isRunning(job) && job?.status !== 'succeeded') return json(502, { error: 'Não foi possível gerar a apostila agora.' });
      return json(202, { pending: true });
    }
    const jobId = await claim(admin, auth.user.id, ctx, 'estudante');
    if (jobId) EdgeRuntime.waitUntil(generate(admin, auth.user.id, jobId, ctx));
    return json(202, { pending: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json(502, { error: 'Não foi possível gerar a apostila agora.', detail: message.slice(0, 300) });
  }
});
