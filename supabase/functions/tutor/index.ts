// Edge Function "tutor": Aprender por Questões (aula guiada por perguntas da IA e revisão espaçada dos conceitos).
// As perguntas daqui são atividade didática: nada é gravado em question_attempts. POST:
//   {taskId} → 200 {lesson, lessonKey} se a aula do tema existe (com `parcial` enquanto a prática é escrita); senão
//     começa a gerar em segundo plano e responde 202 {pending}.
//   {taskId, poll:true} → como acima, sem começar nada; 502 se a geração falhou.
//   {action:'grade', subject, question, answer} → 200 {correta, comentario}; correção de resposta escrita.
//   {action:'review', planId} → 200 {questions, concepts}; uma pergunta nova para cada conceito vencido (até 8).
//   {action:'report', lessonKey, taskId, question, reason, note} → 200; tira a pergunta da aula e manda para a triagem.
// A aula é reaproveitada entre sessões e estudantes com o mesmo tema, fontes e banca (tutor_lessons).
import type { z } from 'zod';
import { GeminiError, generateJson, type GeminiUsage } from '../../../shared/ai/gemini.ts';
import { normalizeText } from '../../../shared/ai/notice.ts';
import { missingMark } from '../../../shared/ai/marks.ts';
import { lawKeys, topicKeys } from '../../../shared/ai/guide.ts';
import {
  applyVerdicts, cleanConcepts, cleanQuestions, lessonUsable, TUTOR_GRADE_VERSION, TUTOR_PROMPT_VERSION, TUTOR_REVIEW_VERSION, tutorCacheKey, TutorGrade, tutorGradeJsonSchema, tutorGradePrompt,
  TutorOutline, tutorOutlineJsonSchema, tutorOutlinePrompt, TutorQuestions, tutorQuestionsJsonSchema, tutorQuestionsPrompt, tutorReviewPrompt, TutorVerdicts, tutorVerdictsJsonSchema, tutorVerifyPrompt,
  type TutorInput, type TutorPart,
} from '../../../shared/ai/tutor.ts';
import { dueConcepts, LETTERS, type Level, type TutorConcept, type TutorLesson, type TutorQuestion } from '../../../shared/domain/tutor.ts';
import { aiFor } from '../_shared/ai.ts';
import { adminClient, CORS, json, logUsage, requireUser } from '../_shared/http.ts';
import { loadLawSources } from '../_shared/law.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const STUCK_MS = 4 * 60 * 1000; // geração interrompida: libera nova tentativa
const THINKING = 'low' as const;
// O revisor raciocina mais: é ele quem segura gabarito errado e ambiguidade.
const VERIFY_THINKING = 'medium' as const;

type Auth = Exclude<Awaited<ReturnType<typeof requireUser>>, Response>;
type Admin = ReturnType<typeof adminClient>;

// Tudo o que define a aula de uma tarefa; null se a tarefa não tem sessão de conteúdo.
async function resolve(auth: Auth, admin: Admin, taskId: string) {
  const { data: task } = await auth.client.from('tasks').select('subject_id, session_id').eq('id', taskId).maybeSingle();
  if (!task?.session_id || !task.subject_id) return null;
  const [{ data: session }, { data: subject }] = await Promise.all([
    auth.client.from('study_sessions').select('title, topic_ids, law_refs').eq('id', task.session_id).single(),
    auth.client.from('notice_subjects').select('name, notice_id').eq('id', task.subject_id).single(),
  ]);
  if (!session || !subject) return null;
  const [{ data: notice }, { data: tt }, { data: map }] = await Promise.all([
    auth.client.from('notices').select('board, role_name').eq('id', subject.notice_id).single(),
    session.topic_ids?.length ? auth.client.from('notice_topics').select('id, text').in('id', session.topic_ids) : Promise.resolve({ data: [] as { id: string; text: string }[] }),
    admin.from('qbank_subject_maps').select('banca_tipo').eq('subject_id', task.subject_id).maybeSingle(),
  ]);
  const topics = (tt ?? []).sort((a, b) => session.topic_ids.indexOf(a.id) - session.topic_ids.indexOf(b.id)).map((t) => t.text);
  const { articles, extra, law } = await loadLawSources(admin, { title: session.title, topics, subject: subject.name, ownerId: auth.user.id, lawRefs: session.law_refs });
  const input: TutorInput = { banca: String(notice?.board ?? ''), cargo: String(notice?.role_name ?? ''), subject: subject.name, title: session.title, topics, law, format: String(map?.banca_tipo ?? '') };
  return { input, key: tutorCacheKey(input), articles, extra, noticeId: subject.notice_id as string };
}
type Ctx = NonNullable<Awaited<ReturnType<typeof resolve>>>;

const lastJob = async (admin: Admin, key: string) => (await admin.from('ai_jobs').select('status, started_at').eq('kind', 'tutor_lesson').eq('input->>cacheKey', key)
  .order('created_at', { ascending: false }).limit(1).maybeSingle()).data;
const isRunning = (job: { status: string; started_at: string | null } | null) => job?.status === 'running' && Date.now() - new Date(job.started_at ?? 0).getTime() < STUCK_MS;

// Trava a geração: o índice único de ai_jobs garante uma por aula. null se já há outra em andamento.
async function claim(admin: Admin, ownerId: string, ctx: Ctx) {
  await admin.from('ai_jobs').update({ status: 'failed', finished_at: new Date().toISOString(), error: 'Geração interrompida.' })
    .eq('kind', 'tutor_lesson').eq('status', 'running').eq('input->>cacheKey', ctx.key).lt('started_at', new Date(Date.now() - STUCK_MS).toISOString());
  const { data, error } = await admin.from('ai_jobs').insert({
    owner_id: ownerId, kind: 'tutor_lesson', status: 'running', started_at: new Date().toISOString(), input: { cacheKey: ctx.key, noticeId: ctx.noticeId },
  }).select('id').single();
  if (error?.code === '23505') return null;
  if (error) throw new Error(error.message);
  return data!.id as string;
}

function usageAcc() {
  let usage: GeminiUsage | null = null;
  return {
    add: (u: GeminiUsage | null | undefined) => { if (u) usage = usage ? { inputTokens: usage.inputTokens + u.inputTokens, outputTokens: usage.outputTokens + u.outputTokens, thinkingTokens: usage.thinkingTokens + u.thinkingTokens } : u; },
    get: () => usage,
  };
}

// Conferência pelo revisor (IA), com uma nova tentativa. Sem conferência, as perguntas não são servidas.
async function verify(ai: { model: string; apiKey: string }, acc: ReturnType<typeof usageAcc>, input: TutorInput, qs: TutorQuestion[]) {
  if (!qs.length) return qs;
  let last: unknown;
  for (let i = 0; i < 2; i++) {
    try {
      const r = await generateJson({ ...ai, schema: TutorVerdicts, jsonSchema: tutorVerdictsJsonSchema(), temperature: 0, thinkingLevel: VERIFY_THINKING, parts: [{ text: tutorVerifyPrompt(input, qs) }] });
      acc.add(r.usage);
      const out = applyVerdicts(qs, r.data);
      const rejected = r.data.avaliacoes.filter((a) => !a.aprovada);
      if (rejected.length) console.log('tutor: reprovadas', rejected.map((a) => `${a.id}: ${a.motivo}`).join(' | '));
      return out;
    } catch (e) {
      if (e instanceof GeminiError) acc.add(e.usage);
      last = e;
    }
  }
  throw last;
}

async function generate(admin: Admin, ownerId: string, jobId: string, ctx: Ctx) {
  const ai = aiFor('tutor'), started = Date.now(), acc = usageAcc();
  const { input, key } = ctx;
  const ask = <T,>(schema: z.ZodType<T>, jsonSchema: unknown, text: string) =>
    generateJson({ ...ai, schema, jsonSchema, temperature: 0.4, thinkingLevel: THINKING, parts: [{ text }] }).then((r) => { acc.add(r.usage); return r.data; })
      .catch((e) => { if (e instanceof GeminiError) acc.add(e.usage); throw e; });
  const save = async (content: TutorLesson) => {
    const { error } = await admin.from('tutor_lessons').upsert({
      cache_key: key, subject_key: normalizeText(input.subject), banca: normalizeText(input.banca), title: input.title, topic_keys: topicKeys(input.topics),
      sources: lawKeys(input.law), content, model: ai.model, prompt_version: TUTOR_PROMPT_VERSION, created_at: new Date().toISOString(),
    }, { onConflict: 'cache_key' });
    if (error) throw new Error(error.message);
  };
  const clean = { provided: ctx.articles, subject: input.subject, extra: ctx.extra };
  try {
    const outline = await ask(TutorOutline, tutorOutlineJsonSchema(), tutorOutlinePrompt(input));
    const conceitos = cleanConcepts(outline.conceitos, clean).slice(0, 8);
    if (conceitos.length < 2) throw new Error('Roteiro sem conceitos suficientes.');
    const roteiro = { titulo: outline.titulo, conceitos };
    const part = async (p: TutorPart) => {
      const r = await ask(TutorQuestions, tutorQuestionsJsonSchema(), tutorQuestionsPrompt(input, roteiro, p));
      const { kept, dropped } = cleanQuestions(r.questoes as TutorQuestion[], { ...clean, concepts: conceitos });
      if (dropped.length) console.log(`tutor ${p}: descartadas`, dropped.map((d) => `${d.id}: ${d.motivo}`).join(' | '));
      return await verify(ai, acc, input, kept);
    };
    // Diagnóstico e construção primeiro: gravados assim que conferidos, o estudante já começa.
    const pratica = part('pratica');
    pratica.catch(() => {}); // tratada no await abaixo
    const inicio = await part('inicio');
    const first: TutorLesson = { ...roteiro, questoes: inicio, parcial: true };
    if (!lessonUsable(first)) throw new Error('Perguntas de construção insuficientes depois da conferência.');
    await save(first);
    const rest = await pratica;
    // Repetidas entre as duas partes: fica a primeira (as do início já podem estar na tela).
    // Sem embaralhar de novo: as alternativas das perguntas do início já podem estar na tela.
    const all = cleanQuestions([...inicio, ...rest], { ...clean, concepts: conceitos, shuffle: false }).kept;
    await save({ ...roteiro, questoes: all });
    await admin.from('ai_jobs').update({ status: 'succeeded', finished_at: new Date().toISOString(), result: { questions: all.length } }).eq('id', jobId);
    await logUsage(admin, { ownerId, jobId, operation: 'tutor_lesson', model: ai.model, promptVersion: TUTOR_PROMPT_VERSION, usage: acc.get(), latencyMs: Date.now() - started, status: 'ok' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Aula parcial que não se completou não fica no cache: a próxima tentativa refaz tudo. Quem já está no meio dela
    // continua, pois a sessão guarda a sua cópia.
    await admin.from('tutor_lessons').delete().eq('cache_key', key).eq('content->>parcial', 'true');
    await admin.from('ai_jobs').update({ status: 'failed', finished_at: new Date().toISOString(), error: message.slice(0, 1000) }).eq('id', jobId);
    await logUsage(admin, { ownerId, jobId, operation: 'tutor_lesson', model: ai.model, promptVersion: TUTOR_PROMPT_VERSION, usage: acc.get(), latencyMs: Date.now() - started, status: 'error', error: message }).catch(() => {});
  }
}

// Aula servida sem as perguntas reportadas e sem as que falam em termo destacado sem marcá-lo (aulas gravadas antes
// da conferência).
const served = (row: { content: TutorLesson; blocked: string[] | null }): TutorLesson => {
  const blocked = new Set(row.blocked ?? []);
  return { ...row.content, questoes: row.content.questoes.filter((q) => !blocked.has(q.id) && !missingMark(q.enunciado)) };
};

async function lesson(auth: Auth, admin: Admin, body: { taskId?: unknown; poll?: unknown }) {
  const ctx = await resolve(auth, admin, String(body.taskId ?? ''));
  if (!ctx) return json(400, { error: 'O Aprender por Questões funciona nas tarefas com conteúdo do edital.' });
  const { data: row } = await admin.from('tutor_lessons').select('content, blocked').eq('cache_key', ctx.key).maybeSingle();
  const running = isRunning(await lastJob(admin, ctx.key));
  if (row && (!row.content?.parcial || running)) return json(200, { lesson: served(row as { content: TutorLesson; blocked: string[] }), lessonKey: ctx.key });
  if (body.poll) {
    if (!running) return json(502, { error: 'Não foi possível preparar a aula agora. Tente de novo em instantes.' });
    return json(202, { pending: true });
  }
  const jobId = await claim(admin, auth.user.id, ctx);
  if (jobId) EdgeRuntime.waitUntil(generate(admin, auth.user.id, jobId, ctx));
  return json(202, { pending: true });
}

async function grade(auth: Auth, admin: Admin, body: Record<string, unknown>) {
  const q = (body.question ?? {}) as Partial<TutorQuestion>;
  const answer = String(body.answer ?? '').trim();
  if (!answer || !q.enunciado || !q.gabarito) return json(400, { error: 'Resposta incompleta.' });
  const ai = aiFor('tutor'), started = Date.now();
  try {
    const r = await generateJson({ ...ai, schema: TutorGrade, jsonSchema: tutorGradeJsonSchema(), temperature: 0, thinkingLevel: THINKING, timeoutMs: 25_000,
      parts: [{ text: tutorGradePrompt({ subject: String(body.subject ?? ''), enunciado: String(q.enunciado), gabarito: String(q.gabarito), aceitas: (q.aceitas ?? []).map(String), explicacao: String(q.explicacao ?? ''), resposta: answer }) }] });
    await logUsage(admin, { ownerId: auth.user.id, operation: 'tutor_grade', model: ai.model, promptVersion: TUTOR_GRADE_VERSION, usage: r.usage, latencyMs: Date.now() - started, status: 'ok' });
    return json(200, r.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logUsage(admin, { ownerId: auth.user.id, operation: 'tutor_grade', model: ai.model, promptVersion: TUTOR_GRADE_VERSION, usage: err instanceof GeminiError ? err.usage : null, latencyMs: Date.now() - started, status: 'error', error: message }).catch(() => {});
    return json(502, { error: 'Não foi possível corrigir agora.', detail: message.slice(0, 300) });
  }
}

interface ConceptRow { concept_key: string; name: string; essence: string; base: string; context: { subject?: string; banca?: string } | null; level: Level; lapses: number; due_on: string | null; recent: string[] }

async function review(auth: Auth, admin: Admin, planId: string) {
  const today = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10); // dia de Brasília
  const { data: rows, error } = await auth.client.from('tutor_concepts').select('concept_key, name, essence, base, context, level, lapses, due_on, recent')
    .eq('plan_id', planId).lte('due_on', today).limit(500);
  if (error) throw new Error(error.message);
  const due = dueConcepts((rows ?? []) as ConceptRow[], today);
  if (!due.length) return json(200, { questions: [], concepts: [] });
  const subject = due[0]!.context?.subject ?? '';
  // Lei seca dos dispositivos que fundamentam os conceitos (os mesmos trechos que a aula usou).
  const bases = [...new Set(due.map((c) => c.base).filter(Boolean))];
  const sources = bases.length ? await loadLawSources(admin, { title: bases.join('; '), topics: [], subject, ownerId: auth.user.id }).catch(() => null) : null;
  const ids = due.map((_, i) => `k${i + 1}`);
  const concepts: TutorConcept[] = due.map((c, i) => ({ id: ids[i]!, nome: c.name, essencial: c.essence, explicacao: c.essence, outro_jeito: '', base: c.base }));
  const ai = aiFor('tutor'), started = Date.now(), acc = usageAcc();
  const input: TutorInput = { banca: due[0]!.context?.banca ?? '', cargo: '', subject, title: 'Revisão espaçada', topics: [], law: sources?.law ?? [], format: '' };
  try {
    const r = await generateJson({ ...ai, schema: TutorQuestions, jsonSchema: tutorQuestionsJsonSchema(), temperature: 0.5, thinkingLevel: THINKING,
      parts: [{ text: tutorReviewPrompt(due.map((c, i) => ({ id: ids[i]!, nome: c.name, essencial: c.essence, base: c.base, subject: c.context?.subject ?? '', banca: c.context?.banca ?? '', recent: c.recent ?? [], level: c.level })), input.law) }] });
    acc.add(r.usage);
    const recent = due.flatMap((c, i) => (c.recent ?? []).map((enunciado, j) => ({ id: `old${i}-${j}`, enunciado }) as TutorQuestion));
    const { kept } = cleanQuestions((r.data.questoes as TutorQuestion[]).map((q) => ({ ...q, etapa: 'revisao' as const })), { concepts, provided: sources?.articles ?? [], subject, extra: sources?.extra ?? [], existing: recent });
    // Uma por conceito: a primeira que passou.
    const one = ids.flatMap((id) => kept.filter((q) => q.conceito === id).slice(0, 1));
    const verified = await verify(ai, acc, input, one);
    await logUsage(admin, { ownerId: auth.user.id, operation: 'tutor_review', model: ai.model, promptVersion: TUTOR_REVIEW_VERSION, usage: acc.get(), latencyMs: Date.now() - started, status: 'ok' });
    const keyOf = new Map(ids.map((id, i) => [id, due[i]!.concept_key]));
    return json(200, {
      questions: verified.map((q, i) => ({ ...q, id: `v${i + 1}`, conceito: keyOf.get(q.conceito)! })),
      concepts: due.map((c) => ({ id: c.concept_key, nome: c.name, essencial: c.essence, explicacao: c.essence, outro_jeito: '', base: c.base })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logUsage(admin, { ownerId: auth.user.id, operation: 'tutor_review', model: ai.model, promptVersion: TUTOR_REVIEW_VERSION, usage: acc.get(), latencyMs: Date.now() - started, status: 'error', error: message }).catch(() => {});
    return json(502, { error: 'Não foi possível preparar a revisão agora. Tente de novo em instantes.', detail: message.slice(0, 300) });
  }
}

const REASONS: Record<string, string> = { gabarito: 'Gabarito errado ou discutível', enunciado: 'Enunciado confuso ou com erro', fora: 'Fora do tema', outro: 'Outro problema' };

// Contestação: a pergunta sai da aula para todos (até a triagem) e o relato entra na fila de /relatos.
async function report(auth: Auth, admin: Admin, body: Record<string, unknown>) {
  const q = (body.question ?? {}) as Partial<TutorQuestion>;
  const reason = REASONS[String(body.reason ?? '')] ?? REASONS.outro!;
  const note = String(body.note ?? '').slice(0, 1500);
  const key = String(body.lessonKey ?? '');
  if (!q.id || !q.enunciado) return json(400, { error: 'Pergunta não informada.' });
  if (key) {
    const { data: row } = await admin.from('tutor_lessons').select('blocked').eq('cache_key', key).maybeSingle();
    if (row && !(row.blocked ?? []).includes(q.id)) await admin.from('tutor_lessons').update({ blocked: [...(row.blocked ?? []), q.id] }).eq('cache_key', key);
  }
  const answer = q.formato === 'multipla' ? `${q.gabarito}) ${q.alternativas?.[LETTERS.indexOf(String(q.gabarito))] ?? ''}` : q.formato === 'ordenacao' ? (q.alternativas ?? []).join(' → ') : String(q.gabarito ?? '');
  const message = [
    `[Aprender por Questões] ${reason}`,
    key ? `Aula: ${key} · pergunta ${q.id}` : `Revisão · pergunta ${q.id}`,
    `Pergunta: ${q.enunciado}`,
    ...(q.formato === 'multipla' ? (q.alternativas ?? []).map((a, i) => `${LETTERS[i]}) ${a}`) : []),
    `Gabarito: ${answer}`,
    `Explicação: ${q.explicacao ?? ''}`,
    note ? `Comentário do estudante: ${note}` : '',
  ].filter(Boolean).join('\n').slice(0, 4000);
  const { error } = await admin.from('feedback').insert({ owner_id: auth.user.id, email: auth.user.email, kind: 'bug', message, page: body.taskId ? `/estudo/${String(body.taskId)}` : '/aprender/revisao' });
  if (error) throw new Error(error.message);
  return json(200, { ok: true });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const auth = await requireUser(req, { ai: body.action !== 'report' });
  if (auth instanceof Response) return auth;
  const admin = adminClient();
  try {
    if (body.action === 'grade') return await grade(auth, admin, body);
    if (body.action === 'review') return await review(auth, admin, String(body.planId ?? ''));
    if (body.action === 'report') return await report(auth, admin, body);
    return await lesson(auth, admin, body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json(502, { error: 'Não foi possível concluir agora.', detail: message.slice(0, 300) });
  }
});
