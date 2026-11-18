// Aprender por Questões no app: aula da Edge Function "tutor", sessões salvas a cada resposta (tutor_sessions) e
// domínio/revisão dos conceitos (tutor_concepts). Nada daqui vai para question_attempts: não conta nas metas de questões.
import { useQuery } from '@tanstack/react-query';
import { ymd } from '../../../shared/domain/dates.ts';
import { isStrong, scheduleAfterLesson, scheduleAfterReview, reviewOutcome, type AnswerLog, type ConceptMemory, type Level, type TutorConcept, type TutorLesson, type TutorQuestion, type TutorState } from '../../../shared/domain/tutor.ts';
import type { Question } from './questions.ts';
import { supabase } from './supabase.ts';

async function call<T>(body: Record<string, unknown>): Promise<{ data: T }> {
  const { data, error } = await supabase.functions.invoke('tutor', { body });
  if (error) {
    let msg = error.message;
    try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* sem JSON */ }
    throw new Error(msg);
  }
  return { data: data as T };
}

const POLL_MS = 4000, GIVE_UP_MS = 4 * 60 * 1000;

// Espera a aula: a geração roda no servidor. A primeira parte (diagnóstico e construção) chega antes; `onLesson` é chamado
// a cada versão nova, e a espera continua até a aula completa. Se a segunda parte falhar com a primeira já em uso,
// devolve a aula como está (`incomplete`). null se a espera foi cancelada.
export async function waitLesson(taskId: string, cancelled: () => boolean, onLesson: (l: TutorLesson, key: string) => void): Promise<{ lesson: TutorLesson; key: string; incomplete?: boolean } | null> {
  const giveUp = Date.now() + GIVE_UP_MS;
  let poll = false, last: { lesson: TutorLesson; key: string } | null = null;
  while (!cancelled()) {
    try {
      const { data } = await call<{ lesson?: TutorLesson; lessonKey?: string }>({ taskId, poll });
      if (data.lesson && data.lessonKey) {
        last = { lesson: data.lesson, key: data.lessonKey };
        onLesson(data.lesson, data.lessonKey);
        if (!data.lesson.parcial) return last;
      }
    } catch (e) {
      if (last) return { ...last, incomplete: true };
      throw e;
    }
    if (Date.now() > giveUp) {
      if (last) return { ...last, incomplete: true };
      throw new Error('A aula está demorando mais que o normal. Tente de novo em instantes.');
    }
    poll = true;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return null;
}

export const gradeAnswer = async (subject: string, q: TutorQuestion, answer: string) =>
  (await call<{ correta: boolean; comentario: string }>({ action: 'grade', subject, question: { enunciado: q.enunciado, gabarito: q.gabarito, aceitas: q.aceitas, explicacao: q.explicacao }, answer })).data;

export const reportTutorQuestion = async (p: { lessonKey: string | null; taskId: string | null; question: TutorQuestion; reason: string; note: string }) =>
  void await call({ action: 'report', ...p });

// Questões reais que treinam cada conceito (as ainda não resolvidas, já no banco do app).
export const fetchPractice = async (taskId: string, concepts: { id: string; nome: string; essencial: string }[]) =>
  (await call<{ groups: { conceito: string; questions: Question[] }[] }>({ action: 'practice', taskId, concepts })).data.groups;

export const fetchReview = async (planId: string) =>
  (await call<{ questions: TutorQuestion[]; concepts: TutorConcept[] }>({ action: 'review', planId })).data;

// ---------- Sessões ----------

// Estado salvo: o motor da aula e uma cópia da aula usada (a retomada não depende da IA nem de a aula mudar no cache).
export interface SavedState extends TutorState { lesson: TutorLesson; lessonKey: string | null; incomplete?: boolean; elapsed: number }
export interface TutorSessionRow { id: string; kind: 'aula' | 'revisao'; status: 'andamento' | 'concluida'; state: SavedState; answered: number; strong: number; started_at: string; finished_at: string | null }

const SESSION_COLS = 'id, kind, status, state, answered, strong, started_at, finished_at';

export async function lastTaskSession(taskId: string) {
  const { data, error } = await supabase.from('tutor_sessions').select(SESSION_COLS).eq('task_id', taskId).eq('kind', 'aula').order('started_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data as TutorSessionRow | null;
}

// Revisão de hoje ainda aberta (retomada): começada hoje e não concluída.
export async function openReviewSession(planId: string) {
  const { data, error } = await supabase.from('tutor_sessions').select(SESSION_COLS).eq('plan_id', planId).eq('kind', 'revisao').eq('status', 'andamento')
    .gte('started_at', `${ymd(new Date())}T00:00:00`).order('started_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data as TutorSessionRow | null;
}

export async function createSession(p: { planId: string; taskId: string | null; kind: 'aula' | 'revisao'; state: SavedState }) {
  const { data, error } = await supabase.from('tutor_sessions').insert({ plan_id: p.planId, task_id: p.taskId, kind: p.kind, lesson_key: p.state.lessonKey, state: p.state }).select(SESSION_COLS).single();
  if (error) throw new Error(error.message);
  return data as TutorSessionRow;
}

export async function saveSession(id: string, state: SavedState, finished = false) {
  const { error } = await supabase.from('tutor_sessions').update({
    state, answered: Math.min(500, state.logs.length), strong: Math.min(500, state.logs.filter(isStrong).length), duration_s: Math.min(86400, Math.round(state.elapsed)),
    updated_at: new Date().toISOString(), ...(finished ? { status: 'concluida', finished_at: new Date().toISOString() } : {}),
  }).eq('id', id);
  if (error) throw new Error(error.message);
}

// ---------- Conceitos ----------

export interface ConceptRow extends ConceptMemory {
  concept_key: string; plan_id: string; subject_id: string | null; task_id: string | null; name: string; essence: string; base: string;
  context: { subject?: string; banca?: string; title?: string }; strong: number; weak: number; wrong: number; recent: string[]; last_seen_at: string;
}
const CONCEPT_COLS = 'concept_key, plan_id, subject_id, task_id, name, essence, base, context, level, step, lapses, reviews, strong, weak, wrong, due_on, recent, last_seen_at';
export const conceptKey = (lessonKey: string, conceptId: string) => `${lessonKey}:${conceptId}`.slice(0, 160);

export const useTutorConcepts = (planId: string | undefined) => useQuery({
  queryKey: ['tutor-concepts', planId],
  enabled: !!planId,
  queryFn: async () => {
    const { data, error } = await supabase.from('tutor_concepts').select(CONCEPT_COLS).eq('plan_id', planId!).order('due_on').limit(2000);
    if (error) throw new Error(error.message);
    return data as ConceptRow[];
  },
});

// Conceitos de uma aula já estudados antes pelo estudante (para pular a construção dos dominados).
export async function knownConcepts(lessonKey: string, lesson: TutorLesson) {
  const keys = lesson.conceitos.map((c) => conceptKey(lessonKey, c.id));
  const { data } = await supabase.from('tutor_concepts').select('concept_key, level').in('concept_key', keys);
  const dominated = new Set((data ?? []).filter((r) => r.level === 'dominado').map((r) => r.concept_key as string));
  return lesson.conceitos.filter((c) => dominated.has(conceptKey(lessonKey, c.id))).map((c) => c.id);
}

const pushRecent = (recent: string[], add: string[]) => [...recent, ...add].map((s) => s.slice(0, 300)).slice(-12);
const counts = (logs: AnswerLog[]) => ({ strong: logs.filter(isStrong).length, weak: logs.filter((l) => l.correct && !isStrong(l)).length, wrong: logs.filter((l) => !l.correct).length });

// Fim da aula: grava o domínio de cada conceito e agenda a primeira revisão.
export async function saveLessonConcepts(p: {
  planId: string; taskId: string; subjectId: string | null; lessonKey: string; lesson: TutorLesson; state: TutorState; levels: { id: string; level: Level }[];
  context: ConceptRow['context']; examDate: string | null;
}) {
  const keys = p.levels.map((l) => conceptKey(p.lessonKey, l.id));
  const { data: prev } = await supabase.from('tutor_concepts').select(CONCEPT_COLS).in('concept_key', keys);
  const today = ymd(new Date()), now = new Date().toISOString();
  const rows = p.levels.map(({ id, level }) => {
    const c = p.lesson.conceitos.find((x) => x.id === id)!, key = conceptKey(p.lessonKey, id);
    const old = (prev ?? []).find((r) => r.concept_key === key) as ConceptRow | undefined;
    const logs = p.state.logs.filter((l) => l.conceito === id), n = counts(logs);
    const seen = logs.map((l) => p.lesson.questoes.find((q) => q.id === l.qid)?.enunciado ?? '').filter(Boolean);
    return {
      concept_key: key, plan_id: p.planId, subject_id: p.subjectId, task_id: p.taskId, name: c.nome.slice(0, 300), essence: c.essencial.slice(0, 2000), base: c.base.slice(0, 300), context: p.context,
      ...scheduleAfterLesson(old ?? null, level, today, p.examDate),
      strong: (old?.strong ?? 0) + n.strong, weak: (old?.weak ?? 0) + n.weak, wrong: (old?.wrong ?? 0) + n.wrong,
      recent: pushRecent(old?.recent ?? [], seen), last_seen_at: now,
    };
  });
  if (!rows.length) return;
  const { error } = await supabase.from('tutor_concepts').upsert(rows, { onConflict: 'owner_id,concept_key' });
  if (error) throw new Error(error.message);
}

// Fim da revisão: cada conceito respondido avança, repete ou volta, conforme a resposta.
export async function saveReviewConcepts(rows: ConceptRow[], lesson: TutorLesson, logs: AnswerLog[], examDate: string | null) {
  const today = ymd(new Date()), now = new Date().toISOString();
  const out = rows.flatMap((r) => {
    const l = logs.find((x) => x.conceito === r.concept_key);
    if (!l) return [];
    const n = counts([l]), q = lesson.questoes.find((x) => x.id === l.qid);
    return [{
      concept_key: r.concept_key, plan_id: r.plan_id, subject_id: r.subject_id, task_id: r.task_id, name: r.name, essence: r.essence, base: r.base, context: r.context,
      ...scheduleAfterReview(r, reviewOutcome(l), today, examDate),
      strong: r.strong + n.strong, weak: r.weak + n.weak, wrong: r.wrong + n.wrong, recent: pushRecent(r.recent, q ? [q.enunciado] : []), last_seen_at: now,
    }];
  });
  if (!out.length) return;
  const { error } = await supabase.from('tutor_concepts').upsert(out, { onConflict: 'owner_id,concept_key' });
  if (error) throw new Error(error.message);
}
