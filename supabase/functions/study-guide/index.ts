// Edge Function "study-guide": apostila da sessão gerada pela IA, baseada só no conteúdo do edital e nos
// artigos oficiais da lei seca, sempre em segundo plano (o texto aparece em cerca de 30 s; não depende da tela aberta). POST:
//   {taskId, depth:'completa'|'revisao'|'aprofundamento'} → 200 {guide} se já existe; senão começa a gerar e responde 202 {pending}.
//   {taskId, depth, poll:true} → como acima, mas não começa nada: 502 se a geração falhou.
//   {action:'prepare', planId} → 202; prepara as apostilas completas das próximas sessões (ver PREPARE_*).
//   {action:'pente', taskId} → 200 {items}; o que memorizar e as pegadinhas das sessões já estudadas da matéria (só leitura).
// Reaproveita apostilas idênticas (mesmo tema, fontes e profundidade) entre sessões e estudantes.
// Não há "gerar de novo" pelo estudante (economia de créditos): uma apostila existente é sempre reaproveitada.
import { GeminiError, generateJson, type GeminiUsage } from '../../../shared/ai/gemini.ts';
import type { z } from 'zod';
import { applyBoardEvidence, roleSpecific, BOARD_SAMPLE_MAX, boardSample, Guide, guideCacheKey, GuideExtras, guideExtrasJsonSchema, GuideOutline, guideOutlineJsonSchema, GuideSections, guideSectionsJsonSchema, guideStage, mergeReviewHalves, reviewHalfJsonSchema, ReviewHalves, reviewStage, sectionGroups, textFromOutline, guidePracticeJsonSchema, GuidePractice, GuideText, guideTextJsonSchema, guideVersion, guidePrompt, mergeGuide, partialGuide, lawKeys, pickSimilarGuide, topicKeys, trimReview, unlistedLaws, verifyGuide, type BoardQuestion, type GuideDepth } from '../../../shared/ai/guide.ts';
import { normalizeText } from '../../../shared/ai/notice.ts';
import { QuestClient } from '../../../shared/qbank/client.ts';
import { materiaOf, measureIncidence, QMAP_PROMPT_VERSION } from '../../../shared/qbank/map.ts';
import { aiFor } from '../_shared/ai.ts';
import { adminClient, CORS, json, logUsage, requireUser } from '../_shared/http.ts';
import { loadLawSources } from '../_shared/law.ts';
import { ensureHot, hotLaws } from '../_shared/hot.ts';
import { hotArticleKeys, hotGuideNote, type HotInput } from '../../../shared/ai/hot.ts';
import { lawByKey } from '../../../shared/legal/registry.ts';
import { cacheQuestions, ensureSessionMap, ensureSubjectMap, mapDeps, plain, publicQuestion, type PublicQuestion } from '../_shared/qbank.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const STUCK_MS = 3 * 60 * 1000; // geração interrompida: libera nova tentativa
// Raciocínio baixo na completa e no aprofundamento: o tempo é quase todo de escrita, e o raciocínio padrão chegava a
// 3.700 tokens sem ganho visível no texto (evals/guide-run.ts, 2026-11-04).
const GUIDE_THINKING = 'low' as const;
// Por chamada, cabe no limite de tempo da função (150 s). Horizonte curto: a sessão quase certamente será estudada.
const PREPARE_DAYS = 3, PREPARE_MAX = 2;
const PREPARE_RETRY_MS = 24 * 3600 * 1000; // apostila que falhou não gasta de novo sem o estudante pedir

type Auth = Exclude<Awaited<ReturnType<typeof requireUser>>, Response>;
type Admin = ReturnType<typeof adminClient>;

// Tudo o que define a apostila de uma tarefa; null se a tarefa não tem sessão de conteúdo.
async function resolve(auth: Auth, admin: Admin, task: { subject_id: string | null; session_id: string | null }, depth: GuideDepth) {
  if (!task.session_id || !task.subject_id) return null;
  const [{ data: session }, { data: subject }] = await Promise.all([
    auth.client.from('study_sessions').select('title, keyword, topic_ids, law_refs').eq('id', task.session_id).single(),
    auth.client.from('notice_subjects').select('name, notice_id').eq('id', task.subject_id).single(),
  ]);
  const { data: notice } = await auth.client.from('notices').select('board, role_name, organization, role_duties, structure').eq('id', subject!.notice_id).single();
  const { data: tt } = session?.topic_ids?.length ? await auth.client.from('notice_topics').select('id, text').in('id', session.topic_ids) : { data: [] };
  const topics = (tt ?? []).sort((a, b) => session!.topic_ids.indexOf(a.id) - session!.topic_ids.indexOf(b.id)).map((t) => t.text);
  // Mais cobrados (IA, em cache compartilhado): na sessão com mais artigos do que cabem, já escolhem os trechos; em toda
  // apostila, viram destaques no prompt (fora da chave do cache).
  const banca = String(notice?.board ?? ''), ownerId = auth.user.id;
  const hotInput = (...a: Parameters<typeof hotLaws>): HotInput => ({ banca, subject: subject!.name, title: session!.title, topics, laws: hotLaws(...a) });
  const { articles, law, extra, omitted, refs, all } = await loadLawSources(admin, { title: session!.title, topics, subject: subject!.name, ownerId, lawRefs: session!.law_refs,
    hot: async (rs, arts, own) => {
      const h = await ensureHot(admin, ownerId, hotInput(rs, arts, own));
      return h ? hotArticleKeys(h, arts, (k) => lawByKey(k, own)?.short ?? k) : [];
    } });
  const input = { depth, banca, subject: subject!.name, title: session!.title, topics, law };
  return {
    extra, input, key: guideCacheKey({ ...input, cargo: String(notice?.role_name ?? '') }), articles, noticeId: subject!.notice_id as string, cargo: (notice?.role_name ?? '') as string,
    duties: String(notice?.role_duties ?? ''), otherRoles: ((notice?.structure as { otherRoles?: string[] } | null)?.otherRoles ?? []) as string[],
    sessionId: task.session_id, subjectId: task.subject_id, keyword: (session?.keyword ?? '') as string,
    organization: String(notice?.organization ?? ''),
    hot: hotInput(refs, all, extra), omitted,
  };
}
type GuideContext = NonNullable<Awaited<ReturnType<typeof resolve>>>;

// 1) Apostila igual (mesmo conteúdo); 2) semelhante (mesma matéria/banca/profundidade, mesmos artigos,
// tópicos e título parecidos), de qualquer sessão ou estudante. Só gera com a IA quando não há nenhuma.
async function findGuide(admin: Admin, { input, key }: GuideContext) {
  const { data: cached } = await admin.from('study_guides').select('*').eq('cache_key', key).maybeSingle();
  if (cached) return cached;
  // Apostila de tema do cargo só serve para o mesmo cargo: aí não vale a de tema parecido.
  if (roleSpecific(input)) return null;
  const { data: similar } = await admin.from('study_guides').select('*').eq('subject_key', normalizeText(input.subject)).eq('depth', input.depth)
    .eq('banca', normalizeText(input.banca)).eq('prompt_version', guideVersion(input.depth)).order('created_at', { ascending: false }).limit(60);
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
      return { name: input.subject, board: input.banca, topics: (all ?? []).map((t) => t.text), organization: ctx.organization };
    });
    const filter = await ensureSessionMap(admin, deps, ownerId, ctx.sessionId, sm.materia, async () => ({ subject: input.subject, title: input.title, keyword: ctx.keyword, topics: input.topics, organization: ctx.organization }));
    // Cobrança real da banca em cada assunto (3 créditos por assunto, uma vez por sessão): a escolha do aprofundamento usa
    // essa medida antes mesmo de a sessão buscar questões.
    if (!filter.incidence && filter.materia && filter.assuntos.length) {
      try {
        const incidence = await measureIncidence((params) => quest.count(params), filter, sm.banca);
        await admin.from('qbank_session_maps').update({ incidence }).eq('session_id', ctx.sessionId);
      } catch (e) { console.error('incidence:', e); }
    }
    // Atualidades envelhece rápido, e sem banca identificada não há o que observar.
    if (!sm.banca || !filter.materia || !filter.assuntos.length || /atualidade/i.test(filter.materia)) return [];
    const { data: cached } = await admin.from('qbank_questions').select('payload').in('materia', [...new Set(filter.assuntos.map((a) => materiaOf(filter, a)!))]).in('assunto', filter.assuntos).limit(300);
    const found = (cached ?? []).map((c) => c.payload as PublicQuestion).filter((q) => normalizeText(q.prova?.banca ?? '') === normalizeText(sm.banca));
    const perAssunto = Math.ceil(BOARD_SAMPLE_MAX / filter.assuntos.length);
    for (const assunto of filter.assuntos) {
      if (found.length >= BOARD_SAMPLE_MAX) break;
      const missing = perAssunto - found.filter((q) => q.assunto === assunto).length;
      if (missing <= 0) continue;
      const r = await quest.questoes({ banca: sm.banca, materia: materiaOf(filter, assunto)!, assunto }, Math.min(missing, BOARD_SAMPLE_MAX - found.length));
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
  const { key, articles, cargo, duties, otherRoles } = ctx;
  const { model, apiKey } = aiFor('guide'), started = Date.now();
  // Destaques dos mais cobrados e seções sem trecho: só no prompt (a chave do cache não muda).
  const hot = await ensureHot(admin, ownerId, ctx.hot);
  const notes = [hotGuideNote(hot), ctx.omitted.length ? `A sessão tem mais artigos do que os trechos acima; ficaram de fora estas seções: ${ctx.omitted.slice(0, 20).join('; ')}. Na introdução, diga ao candidato para lê-las na lei seca.` : ''].filter(Boolean);
  const input = { ...ctx.input, notes };
  let usage: GeminiUsage | null = null, text: GuideText | null = null, split = false;
  const add = (u: GeminiUsage) => { usage = usage ? { inputTokens: usage.inputTokens + u.inputTokens, outputTokens: usage.outputTokens + u.outputTokens, thinkingTokens: usage.thinkingTokens + u.thinkingTokens } : u; };
  const save = async (content: Guide | (Guide & { parcial: true }), board: number) => {
    const v = verifyGuide(applyBoardEvidence(content, input.banca, board), articles, input.subject, ctx.extra);
    const { error } = await admin.from('study_guides').upsert({
      cache_key: key, depth: input.depth, subject_name: input.subject, subject_key: normalizeText(input.subject), banca: normalizeText(input.banca), topic_keys: topicKeys(input.topics),
      title: input.title, content: v.guide, sources: input.law.map((l) => l.ref), unlisted_sources: unlistedLaws([input.title, ...input.topics].join('\n')), unverified: v.unverified,
      model, prompt_version: guideVersion(input.depth), created_at: new Date().toISOString(),
    }, { onConflict: 'cache_key' });
    if (error) throw new Error(error.message);
  };
  // Formato predominante da banca na matéria: as questões de fixação seguem ele.
  const format = async () => String((await admin.from('qbank_subject_maps').select('banca_tipo').eq('subject_id', ctx.subjectId).maybeSingle()).data?.banca_tipo ?? '');
  const ask = <T,>(schema: z.ZodType<T>, jsonSchema: unknown, stage?: string) => generateJson({ apiKey, model, schema, jsonSchema, temperature: 0.3, thinkingLevel: GUIDE_THINKING,
    parts: [{ text: guidePrompt({ ...input, cargo, duties, otherRoles, part: 'texto', stage }) }] }).then((r) => { add(r.usage); return r.data; });
  // Texto da apostila em partes: o roteiro aparece na hora e cada parte é gravada quando fica pronta (as gravações vão em
  // fila, para uma não passar a outra). Sem roteiro, ou sem nenhuma seção escrita, volta ao texto numa chamada só.
  const writeText = async (): Promise<GuideText> => {
    const outline = await ask(GuideOutline, guideOutlineJsonSchema(), guideStage({ kind: 'roteiro' })).catch((e) => { console.error('roteiro:', e); return null; });
    if (!outline?.secoes.length) return await ask(GuideText, guideTextJsonSchema());
    split = true;
    const state = textFromOutline(outline), pending = new Set(outline.secoes.map((_, i) => i));
    let queue = Promise.resolve();
    const show = () => { queue = queue.then(() => save(partialGuide(state, [...pending]), 0)).catch((e) => console.error('parcial:', e)); };
    show();
    const sections = sectionGroups(outline.secoes.length).map((indices) =>
      ask(GuideSections, guideSectionsJsonSchema(), guideStage({ kind: 'secoes', outline, indices })).then((r) => {
        indices.forEach((i, k) => { const x = r.secoes[k]; if (x?.texto.trim()) state.secoes[i] = { ...state.secoes[i]!, texto: x.texto, exemplos: x.exemplos ?? [] }; });
      }).catch((e) => console.error('seções', indices, e)).finally(() => { indices.forEach((i) => pending.delete(i)); show(); }));
    const extras = ask(GuideExtras, guideExtrasJsonSchema(), guideStage({ kind: 'extras', outline })).then((r) => {
      state.quadros = r.quadros; state.legislacao = r.legislacao; show();
    }).catch((e) => console.error('quadros e lei:', e));
    await Promise.all([...sections, extras]);
    await queue;
    // Seção que falhou sai da apostila; sem nenhuma, a apostila é escrita de novo numa chamada só.
    state.secoes = state.secoes.filter((x) => x.texto.trim());
    return state.secoes.length ? state : await ask(GuideText, guideTextJsonSchema());
  };
  try {
    if (input.depth === 'revisao') {
      // A revisão não tem seções, então não tem "como a banca cobra": não compra questões da banca. Sai em duas metades
      // paralelas; a primeira que chega já aparece na tela.
      const base = { ...input, cargo, boardQuestions: [], format: await format(), duties, otherRoles };
      const halves: [Partial<Guide> | null, Partial<Guide> | null] = [null, null];
      let shown = Promise.resolve();
      const half = (i: 0 | 1) => generateJson({ apiKey, model, schema: ReviewHalves[i] as z.ZodType<Partial<Guide>>, jsonSchema: reviewHalfJsonSchema(i), temperature: 0.3, thinkingLevel: GUIDE_THINKING,
        parts: [{ text: guidePrompt({ ...base, stage: reviewStage(i) }) }] }).then((r) => {
        add(r.usage);
        halves[i] = r.data;
        if (!halves[1 - i]) shown = shown.then(() => save({ ...trimReview(mergeReviewHalves(halves[0] ?? {}, halves[1] ?? {})), parcial: true }, 0)).catch(() => {});
      });
      const results = await Promise.allSettled([half(0), half(1)]);
      await shown;
      if (results.every((r) => r.status === 'rejected')) throw (results[0] as PromiseRejectedResult).reason;
      await save(trimReview(mergeReviewHalves(halves[0] ?? {}, halves[1] ?? {})), 0);
    } else {
      // Prática em paralelo, com raciocínio baixo (o tempo é de escrita): começa quando as questões da banca chegam.
      const practice = boardEvidence(admin, ownerId, ctx).then(async (boardQuestions) => {
        const p = await generateJson({ apiKey, model, schema: GuidePractice, jsonSchema: guidePracticeJsonSchema(), temperature: 0.3, thinkingLevel: GUIDE_THINKING,
          parts: [{ text: guidePrompt({ ...input, cargo, boardQuestions, format: await format(), duties, otherRoles, part: 'pratica' }) }] });
        add(p.usage);
        return { data: p.data, board: boardQuestions.length };
      });
      practice.catch(() => {}); // a falha é tratada no await abaixo
      text = await writeText();
      const p = await practice;
      await save(mergeGuide(text, p.data), p.board);
    }
    await admin.from('ai_jobs').update({ status: 'succeeded', finished_at: new Date().toISOString() }).eq('id', jobId);
    // "+partes": escrita em partes (a chave do cache continua a da versão do prompt, para não refazer as apostilas já feitas).
    await logUsage(admin, { ownerId, jobId, operation: 'study_guide', model, promptVersion: `${guideVersion(input.depth)}${split || input.depth === 'revisao' ? '+partes' : ''}`, usage, latencyMs: Date.now() - started, status: 'ok' });
  } catch (err) {
    if (err instanceof GeminiError && err.usage) add(err.usage);
    // Prática falhou com o texto já gravado: a apostila fica só com o texto, sem esperar mais.
    if (text) {
      const { parcial: _, ...done } = partialGuide(text);
      await save(done, 0).catch(() => {});
    }
    const message = err instanceof Error ? err.message : String(err);
    await admin.from('ai_jobs').update({ status: 'failed', finished_at: new Date().toISOString(), error: message.slice(0, 1000) }).eq('id', jobId);
    await logUsage(admin, { ownerId, jobId, operation: 'study_guide', model, promptVersion: guideVersion(input.depth), usage, latencyMs: Date.now() - started, status: 'error', error: message }).catch(() => {});
  }
}

// Pente-fino da reta final: "para memorizar" e pegadinhas das apostilas que já existem para as sessões concluídas da
// matéria da tarefa, da estudada há mais tempo para a mais recente. Só lê: nunca gera apostila nem gasta IA.
const PENTE_MAX = 30;
async function penteFino(auth: Auth, admin: Admin, taskId: string) {
  const { data: task } = await auth.client.from('tasks').select('plan_id, subject_id').eq('id', taskId).maybeSingle();
  if (!task?.subject_id) return [];
  const { data: done } = await auth.client.from('tasks').select('subject_id, session_id').eq('plan_id', task.plan_id).eq('subject_id', task.subject_id)
    .eq('kind', 'theory').not('session_id', 'is', null).not('done_at', 'is', null).order('done_at').limit(500);
  const sessions = [...new Map((done ?? []).map((t) => [t.session_id as string, t])).values()].slice(0, PENTE_MAX);
  const items = await Promise.all(sessions.map(async (t) => {
    const ctx = await resolve(auth, admin, t, 'completa');
    if (!ctx) return null;
    const revisao = { ...ctx, input: { ...ctx.input, depth: 'revisao' as const }, key: guideCacheKey({ ...ctx.input, depth: 'revisao', cargo: ctx.cargo }) };
    // Da completa, o que memorizar e as pegadinhas; da revisão (se já existe), os mnemônicos e os gatilhos.
    const [full, review] = await Promise.all([findGuide(admin, ctx), findGuide(admin, revisao)]);
    type Bits = { memorizar?: string[]; pegadinhas?: string[]; mnemonicos?: { alvo: string; mnemonico: string; explicacao: string }[]; gatilhos?: { pista: string; resposta: string }[] };
    const c = (full ?? review)?.content as Bits | undefined, r = review?.content as Bits | undefined;
    return {
      sessionId: ctx.sessionId, title: ctx.input.title, memorizar: c?.memorizar ?? [], pegadinhas: c?.pegadinhas ?? [],
      mnemonicos: r?.mnemonicos ?? [], gatilhos: r?.gatilhos ?? [], hasGuide: !!(full ?? review),
    };
  }));
  return items.filter((i) => i !== null);
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
    if (body.action === 'pente') return json(200, { items: await penteFino(auth, admin, String(body.taskId ?? '')) });
    const depth: GuideDepth = body.depth === 'revisao' ? 'revisao' : body.depth === 'aprofundamento' ? 'aprofundamento' : 'completa';
    const { data: task } = await auth.client.from('tasks').select('subject_id, session_id').eq('id', String(body.taskId ?? '')).maybeSingle();
    const ctx = task && await resolve(auth, admin, task, depth);
    if (!ctx) return json(400, { error: 'A apostila é gerada para tarefas de teoria (com sessão de conteúdo).' });
    const guide = await findGuide(admin, ctx);
    // Revisões gravadas antes dos tetos também saem curtas.
    // Apostila só com o texto: a prática ainda está sendo escrita (`parcial`); geração parada não deixa a tela esperando.
    if (guide?.content?.parcial && !isRunning(await lastJob(admin, ctx.key))) guide.content = { ...guide.content, parcial: undefined };
    if (guide) return json(200, { guide: depth === 'revisao' ? { ...guide, content: trimReview(guide.content) } : guide });
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
