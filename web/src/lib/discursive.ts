// Discursivas: regras do edital, treinos do estudante e chamadas à função "discursive".
import { useQuery } from '@tanstack/react-query';
import { discursiveRules, itemScale, type DiscursiveFormat, type DiscursiveReport } from '../../../shared/ai/discursive.ts';
import { supabase } from './supabase.ts';

export interface DiscursiveAnswer {
  id: string; notice_id: string; subject_id: string | null; prompt_id: string; format: DiscursiveFormat; title: string; subject_name: string;
  statement: string; support_texts: string[]; lines_hint: number; attempt: number; body: string; seconds: number;
  status: 'draft' | 'grading' | 'graded' | 'failed'; points: number | null; max_points: number | null; pct: number | null;
  report: DiscursiveReport | null; created_at: string; updated_at: string; graded_at: string | null;
}

const COLUMNS = 'id, notice_id, subject_id, prompt_id, format, title, subject_name, statement, support_texts, lines_hint, attempt, body, seconds, status, points, max_points, pct, report, created_at, updated_at, graded_at';

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('discursive', { body });
  if (error) {
    let msg = error.message;
    try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* sem JSON */ }
    throw new Error(msg);
  }
  return data as { id: string };
}

export const startDiscursive = (noticeId: string, subjectId: string | null) => invoke({ action: 'start', noticeId, subjectId });
export const gradeDiscursive = (answerId: string) => invoke({ action: 'grade', answerId });
export const rewriteDiscursive = (answerId: string) => invoke({ action: 'rewrite', answerId });

export async function saveDraft(id: string, body: string, seconds: number) {
  // Sem linha alterada não há erro do banco: o treino já não é rascunho, e o texto não foi gravado.
  const { data, error } = await supabase.from('discursive_answers').update({ body, seconds }).eq('id', id).select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('O treino não está mais em rascunho.');
}
export async function deleteDiscursive(id: string) {
  const { error } = await supabase.from('discursive_answers').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// Regras da discursiva do edital; `rules` null quando o concurso não tem essa prova.
export const useDiscursiveRules = (noticeId: string | undefined) => useQuery({
  queryKey: ['discursive-rules', noticeId],
  enabled: !!noticeId,
  queryFn: async () => {
    const { data, error } = await supabase.from('notices').select('notes, structure').eq('id', noticeId!).single();
    if (error) throw new Error(error.message);
    const rules = discursiveRules((data.structure as { stages?: { kind: string; description: string }[] } | null)?.stages, data.notes as string[]);
    return { rules, scale: rules ? itemScale(rules) : null };
  },
});

export const useDiscursiveAnswers = (noticeId: string | undefined) => useQuery({
  queryKey: ['discursive-answers', noticeId],
  enabled: !!noticeId,
  queryFn: async () => {
    const { data, error } = await supabase.from('discursive_answers').select(COLUMNS).eq('notice_id', noticeId!).order('created_at', { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return data as unknown as DiscursiveAnswer[];
  },
  // Correção em andamento (outra aba ou página recarregada): atualiza até terminar.
  refetchInterval: (q) => (q.state.data?.some((a) => a.status === 'grading') ? 5000 : false),
});

export const STUCK_MS = 3 * 60 * 1000; // igual ao da função: correção interrompida pode ser refeita

// Dias desde o último treino corrigido; null se nunca treinou.
export const useLastDiscursive = (noticeId: string | undefined) => useQuery({
  queryKey: ['discursive-last', noticeId],
  enabled: !!noticeId,
  queryFn: async () => {
    const { data, error } = await supabase.from('discursive_answers').select('graded_at').eq('notice_id', noticeId!).eq('status', 'graded').order('graded_at', { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    const at = (data as { graded_at: string }[])[0]?.graded_at;
    return at ? Math.floor((Date.now() - new Date(at).getTime()) / 864e5) : null;
  },
});

// Resumo do progresso, só com treinos corrigidos. O critério mais fraco considera os últimos 5.
export function discursiveStats(answers: DiscursiveAnswer[]) {
  const graded = answers.filter((a) => a.status === 'graded' && a.report);
  if (!graded.length) return null;
  const recent = graded.slice(0, 5);
  const avg = (ns: number[]) => Math.round(ns.reduce((a, b) => a + b, 0) / ns.length);
  const criteria = (['conteudo', 'estrutura', 'linguagem'] as const).map((k) => ({ key: k, pct: avg(recent.map((a) => a.report!.criterios[k].pct)) }));
  return {
    count: graded.length,
    avgPct: avg(graded.map((a) => a.pct ?? 0)),
    recentPct: avg(recent.map((a) => a.pct ?? 0)),
    weakest: criteria.reduce((w, c) => (c.pct < w.pct ? c : w)),
  };
}
