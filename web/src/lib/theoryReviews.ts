// Revisão de teoria: temas estudados que voltam em 1, 7 e 30 dias. As regras ficam no banco (theory_review_answer).
import { useQuery } from '@tanstack/react-query';
import { ymd } from '../../../shared/domain/dates.ts';
import { partOf } from '../../../shared/domain/parts.ts';
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

// Tema em partes: na revisão da última parte (que conta o tema inteiro), as outras partes, para reler também. Nas outras
// partes (revisão adiada de quem não chegou à última), nada.
export const useThemeParts = (sessionId: string | null | undefined, enabled: boolean) => useQuery({
  queryKey: ['theme-parts', sessionId],
  enabled: enabled && !!sessionId,
  staleTime: 5 * 60_000,
  queryFn: async () => {
    const { data: own, error } = await supabase.from('study_sessions').select('plan_version_id, subject_id, title').eq('id', sessionId!).maybeSingle();
    if (error) throw new Error(error.message);
    const me = own ? partOf(own.title as string) : null;
    if (!own || !me || me.part !== me.parts) return [];
    const { data: list } = await supabase.from('study_sessions').select('id, title').eq('plan_version_id', own.plan_version_id).eq('subject_id', own.subject_id).limit(1000);
    const parts = (list ?? []).map((s) => ({ id: s.id as string, title: s.title as string, p: partOf(s.title as string) }))
      .filter((s) => s.id !== sessionId && s.p && s.p.head === me.head && s.p.parts === me.parts);
    if (!parts.length) return [];
    const { data: tasks } = await supabase.from('tasks').select('id, session_id').eq('kind', 'theory').is('superseded_in_version', null).in('session_id', parts.map((s) => s.id));
    return parts.flatMap((s) => {
      const t = (tasks ?? []).find((x) => x.session_id === s.id);
      return t ? [{ taskId: t.id as string, title: s.title, part: s.p!.part }] : [];
    }).sort((a, b) => a.part - b.part);
  },
});
