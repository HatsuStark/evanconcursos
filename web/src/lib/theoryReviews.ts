// Revisão de teoria: temas estudados que voltam em 1, 7 e 30 dias. As regras ficam no banco (theory_review_answer).
import { useQuery } from '@tanstack/react-query';
import { ymd } from '../../../shared/domain/dates.ts';
import { supabase } from './supabase.ts';

export type ReviewResult = 'lembrei' | 'parcial' | 'esqueci';
export interface TheoryReview {
  id: string; task_id: string; stage: number; due_on: string; status: string; reviews: number; last_result: ReviewResult | null; last_reviewed_at: string | null;
  task: { title: string; subject_id: string | null };
}

// Todos os temas do plano, em ordem de data; a situação de cada um sai de groupReviews.
export const useTheoryReviews = (planId: string | undefined) => useQuery({
  queryKey: ['theory-reviews', planId],
  enabled: !!planId,
  queryFn: async () => {
    const { data, error } = await supabase.from('theory_reviews').select('id, task_id, stage, due_on, status, reviews, last_result, last_reviewed_at, task:tasks(title, subject_id)')
      .eq('plan_id', planId!).order('due_on').limit(1000);
    if (error) throw new Error(error.message);
    return data as unknown as TheoryReview[];
  },
});

// Revisão vencida desta tarefa, se houver.
export const useTaskTheoryReview = (taskId: string) => useQuery({
  queryKey: ['theory-reviews', 'task', taskId],
  queryFn: async () => {
    const { data, error } = await supabase.from('theory_reviews').select('id, stage').eq('task_id', taskId).eq('status', 'pending').lte('due_on', ymd(new Date())).maybeSingle();
    if (error) throw new Error(error.message);
    return data as { id: string; stage: number } | null;
  },
});

// Devolve a data da próxima revisão; null se o tema encerrou.
export async function answerTheoryReview(id: string, result: ReviewResult) {
  const { data, error } = await supabase.rpc('theory_review_answer', { p_id: id, p_result: result });
  if (error) throw new Error(error.message);
  return data as string | null;
}
