// Modo estudo: a tarefa com sua matéria/sessão, conteúdo do edital, tentativas de questões e tempo estudado.
import { useQuery } from '@tanstack/react-query';
import type { Pacing, SubjectRow, TaskRow } from './plans.ts';
import { supabase } from './supabase.ts';

const must = <T,>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

export interface Attempt { id: string; task_id: string | null; session_id: string | null; qid: string; assunto: string; correct: boolean; created_at: string }
export interface StudyData {
  task: TaskRow & { plan_id: string; time_spent_sec: number };
  noticeId: string;
  cutoffPct: number | null;   // última nota de corte do cargo (% da prova), base da meta de acerto
  pacing: Pacing;
  subject: SubjectRow | null;
  subjectIndex: number;
  session: { id: string; title: string; keyword: string; topic_ids: string[] } | null;
  topics: string[];
  attempts: Attempt[];   // da matéria — as da tarefa têm task_id igual
  subjectGoal: number;   // meta de questões das sessões da matéria no cronograma, como no Edital
}

export const useStudy = (taskId: string | undefined) => useQuery({
  queryKey: ['study', taskId],
  enabled: !!taskId,
  queryFn: async (): Promise<StudyData> => {
    const pick = async () => must(await supabase.from('tasks').select('id, plan_id, date, minutes, kind, subject_id, session_id, title, keyword, goal_questions, done_at, time_spent_sec').eq('id', taskId!).single()) as StudyData['task'];
    let task = await pick();
    // Aberto direto pelo link: escolhe o tema do aprofundamento antes de mostrar.
    if (/^(Aprofundamento|Revisão com questões): /.test(task.title) && !task.done_at) {
      const { data: bound } = await supabase.rpc('bind_adaptive_sessions', { p_plan: task.plan_id });
      if (bound) task = await pick();
    }
    const plan = must(await supabase.from('study_plans').select('notice_id, pacing').eq('id', task.plan_id).single()) as { notice_id: string; pacing: Pacing };
    const notice = must(await supabase.from('notices').select('cutoff_pct').eq('id', plan.notice_id).single()) as { cutoff_pct: number | null };
    const [subjects, session, attempts, goals] = await Promise.all([
      supabase.from('notice_subjects').select('id, name, position, is_core, questions, weight').eq('notice_id', plan.notice_id).order('position'),
      task.session_id ? supabase.from('study_sessions').select('id, title, keyword, topic_ids').eq('id', task.session_id).single() : Promise.resolve({ data: null, error: null }),
      task.subject_id ? supabase.from('question_attempts').select('id, task_id, session_id, qid, assunto, correct, created_at').eq('subject_id', task.subject_id).order('created_at', { ascending: false }).limit(2000)
        : supabase.from('question_attempts').select('id, task_id, session_id, qid, assunto, correct, created_at').eq('task_id', task.id),
      task.subject_id ? supabase.from('tasks').select('goal_questions').eq('plan_id', task.plan_id).eq('subject_id', task.subject_id).not('session_id', 'is', null).is('superseded_in_version', null)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const subs = must(subjects) as SubjectRow[], sess = must(session) as StudyData['session'];
    const topics = sess?.topic_ids.length ? (must(await supabase.from('notice_topics').select('id, text').in('id', sess.topic_ids)) as { id: string; text: string }[])
      .sort((a, b) => sess.topic_ids.indexOf(a.id) - sess.topic_ids.indexOf(b.id)).map((t) => t.text) : [];
    const subjectIndex = subs.findIndex((s) => s.id === task.subject_id);
    return { task, noticeId: plan.notice_id, cutoffPct: notice.cutoff_pct, pacing: plan.pacing, subject: subs[subjectIndex] ?? null, subjectIndex, session: sess, topics, attempts: must(attempts) as Attempt[], subjectGoal: (must(goals) as { goal_questions: number }[]).reduce((n, t) => n + t.goal_questions, 0) };
  },
});

export async function saveTimeSpent(taskId: string, seconds: number) {
  await supabase.from('tasks').update({ time_spent_sec: Math.min(86400, Math.round(seconds)) }).eq('id', taskId);
}
