// Edital verticalizado: junta tópicos, sessões, tarefas e questões do concurso (a conta fica em shared/domain/verticalized.ts).
import { useQuery } from '@tanstack/react-query';
import { buildVerticalized, type VSession, type VStat, type VTask, type VTopic } from '../../../shared/domain/verticalized.ts';
import type { ActivePlan } from './plans.ts';
import { supabase } from './supabase.ts';

// O servidor devolve no máximo 1000 linhas por consulta: lê em páginas.
const PAGE = 1000;
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data as T[]));
    if ((data as T[]).length < PAGE) return out;
  }
}

export const useVerticalized = (active: ActivePlan | null | undefined) => useQuery({
  queryKey: ['verticalized', active?.plan.id, active?.plan.active_version_id],
  enabled: !!active,
  queryFn: async () => {
    const { plan, notice, subjects } = active!;
    const ids = subjects.map((s) => s.id);
    const [topics, sessions, tasks, stats] = await Promise.all([
      readAll<VTopic>((a, b) => supabase.from('notice_topics').select('id, subject_id, text').in('subject_id', ids).order('position').order('id').range(a, b)),
      // Todas as versões: questões e tarefas feitas em cronogramas anteriores continuam contando.
      readAll<VSession>((a, b) => supabase.from('study_sessions').select('id, subject_id, plan_version_id, topic_ids').in('subject_id', ids).order('id').range(a, b)),
      readAll<VTask>((a, b) => supabase.from('tasks').select('id, session_id, date, done_at, superseded_in_version').eq('plan_id', plan.id).not('session_id', 'is', null).order('id').range(a, b)),
      readAll<VStat>((a, b) => supabase.rpc('session_attempt_stats', { p_notice: notice.id }).range(a, b)),
    ]);
    return buildVerticalized({ subjects, topics, sessions, tasks, stats, activeVersionId: plan.active_version_id });
  },
});
