// Modo estudo: a tarefa com sua matéria/sessão, registros de questões, filtros salvos e tempo estudado.
import { useQuery } from '@tanstack/react-query';
import { qcUrl, type QcMode } from '../../../shared/domain/qc.ts';
import type { SubjectRow, TaskRow } from './plans.ts';
import { supabase } from './supabase.ts';

const must = <T,>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

export type Provider = 'qconcursos' | 'tecconcursos';
export interface QuestionLog { id: string; task_id: string | null; subject_id: string | null; topic: string; correct: number; total: number; source: string; created_at: string }
export interface FilterRow { id: string; subject_id: string | null; provider: Provider; url: string }
export interface StudyData {
  task: TaskRow & { plan_id: string; time_spent_sec: number };
  subject: SubjectRow | null;
  subjectIndex: number;
  session: { id: string; title: string; keyword: string; topic_ids: string[] } | null;
  topics: string[];
  logs: QuestionLog[];          // desta matéria (para o acerto e a dificuldade)
  filters: FilterRow[];
}

export const useStudy = (taskId: string | undefined) => useQuery({
  queryKey: ['study', taskId],
  enabled: !!taskId,
  queryFn: async (): Promise<StudyData> => {
    const task = must(await supabase.from('tasks').select('id, plan_id, date, minutes, kind, subject_id, session_id, title, keyword, goal_questions, done_at, time_spent_sec').eq('id', taskId!).single()) as StudyData['task'];
    const plan = must(await supabase.from('study_plans').select('notice_id').eq('id', task.plan_id).single()) as { notice_id: string };
    const [subjects, session, logs, filters] = await Promise.all([
      supabase.from('notice_subjects').select('id, name, position, is_core, questions, weight').eq('notice_id', plan.notice_id).order('position'),
      task.session_id ? supabase.from('study_sessions').select('id, title, keyword, topic_ids').eq('id', task.session_id).single() : Promise.resolve({ data: null, error: null }),
      task.subject_id ? supabase.from('question_logs').select('id, task_id, subject_id, topic, correct, total, source, created_at').eq('subject_id', task.subject_id).order('created_at', { ascending: false }).limit(500)
        : supabase.from('question_logs').select('id, task_id, subject_id, topic, correct, total, source, created_at').eq('task_id', task.id),
      supabase.from('question_filters').select('id, subject_id, provider, url').eq('plan_id', task.plan_id),
    ]);
    const subs = must(subjects) as SubjectRow[], sess = must(session) as StudyData['session'];
    const topics = sess?.topic_ids.length ? (must(await supabase.from('notice_topics').select('id, text').in('id', sess.topic_ids)) as { id: string; text: string }[])
      .sort((a, b) => sess.topic_ids.indexOf(a.id) - sess.topic_ids.indexOf(b.id)).map((t) => t.text) : [];
    const subjectIndex = subs.findIndex((s) => s.id === task.subject_id);
    return { task, subject: subs[subjectIndex] ?? null, subjectIndex, session: sess, topics, logs: must(logs) as QuestionLog[], filters: must(filters) as FilterRow[] };
  },
});

export const accuracy = (logs: QuestionLog[]) => {
  const t = logs.reduce((a, l) => a + l.total, 0);
  return t ? logs.reduce((a, l) => a + l.correct, 0) / t : null;
};

// Link do site de questões: QConcursos monta o filtro (assunto, modo e dificuldade pelo acerto);
// TecConcursos abre o filtro salvo como está (o formato da URL dele não é público).
export function questionsUrl(d: StudyData, provider: Provider, mode: QcMode) {
  const pick = (subjectId: string | null) => d.filters.find((f) => f.provider === provider && f.subject_id === subjectId)?.url ?? null;
  const own = d.task.subject_id ? pick(d.task.subject_id) : null, base = pick(null);
  if (provider === 'tecconcursos') return own ?? base ?? 'https://www.tecconcursos.com.br/questoes/filtrar';
  const subjectLogs = d.logs.filter((l) => l.subject_id === d.task.subject_id);
  return qcUrl({
    subject: d.subject?.name ?? '', keyword: d.task.keyword || d.session?.keyword || '', mode,
    accuracy: subjectLogs.reduce((a, l) => a + l.total, 0) >= 10 ? accuracy(subjectLogs) : null, subjectLink: own, baseLink: base,
  });
}

export async function addQuestionLog(d: StudyData, correct: number, total: number, source: Provider | 'outro') {
  const { error } = await supabase.from('question_logs').insert({
    plan_id: d.task.plan_id, task_id: d.task.id, subject_id: d.task.subject_id, session_id: d.task.session_id,
    topic: (d.task.keyword || d.session?.keyword || '').slice(0, 200), correct, total, source,
  });
  if (error) throw new Error(error.message);
}

export async function saveFilter(planId: string, subjectId: string | null, provider: Provider, url: string) {
  const del = supabase.from('question_filters').delete().eq('plan_id', planId).eq('provider', provider);
  const { error: delError } = await (subjectId ? del.eq('subject_id', subjectId) : del.is('subject_id', null));
  if (delError) throw new Error(delError.message);
  if (!url.trim()) return;
  const { error } = await supabase.from('question_filters').insert({ plan_id: planId, subject_id: subjectId, provider, url: url.trim() });
  if (error) throw new Error(/check/i.test(error.message) ? 'Cole um link do QConcursos ou do TecConcursos (https://...).' : error.message);
}

export async function saveTimeSpent(taskId: string, seconds: number) {
  await supabase.from('tasks').update({ time_spent_sec: Math.min(86400, Math.round(seconds)) }).eq('id', taskId);
}
