// Prática fora do cronograma: questões livres, caderno de erros, flashcards, simulados e desempenho por contexto.
import { useQuery } from '@tanstack/react-query';
import { ymd } from '../../../shared/domain/dates.ts';
import type { ErrorReason } from '../../../shared/domain/replan.ts';
import type { Question } from './questions.ts';
import { supabase } from './supabase.ts';

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* sem JSON */ }
    throw new Error(msg);
  }
  return data as T;
}
const practice = <T,>(body: Record<string, unknown>) => invoke<T>('practice', body);

// ---------- questões livres ----------
export interface FreeFilters { materia: string; assunto?: string; banca?: string; ano?: string; dificuldade?: string; orgao?: string; cargo?: string; tipo?: string; onlyNew?: boolean }
export const filterLists = {
  geral: () => practice<{ data: { anos?: (string | number)[]; dificuldades?: (string | number)[]; tiposQuestao?: string[] } }>({ action: 'filters', kind: 'geral' }),
  materias: (q: string) => practice<{ items: string[] }>({ action: 'filters', kind: 'materias', q }),
  assuntos: (materia: string, q = '') => practice<{ items: string[] }>({ action: 'filters', kind: 'assuntos', materia, q }),
  bancas: (q: string) => practice<{ items: string[] }>({ action: 'filters', kind: 'bancas', q }),
};
export const searchFree = (filters: FreeFilters, count = 10) => practice<{ questions: Question[]; reason: string | null }>({ action: 'search', filters, count });
export const reviewDue = (count = 15) => practice<{ questions: Question[]; stages: Record<string, { stage: number; wrong: number }> }>({ action: 'review', count });

// Matérias do concurso já ligadas ao banco de questões (atalhos nos filtros).
export const useMappedMaterias = () => useQuery({
  queryKey: ['mapped-materias'],
  queryFn: async () => {
    const { data } = await supabase.from('qbank_subject_maps').select('materia');
    return [...new Set((data ?? []).map((d) => d.materia as string | null).filter((m): m is string => !!m))];
  },
});

// ---------- caderno de erros e flashcards ----------
export const useDueCounts = () => useQuery({
  queryKey: ['due-counts'],
  queryFn: async () => {
    const today = ymd(new Date());
    const [e, f] = await Promise.all([
      supabase.from('error_book').select('qid', { count: 'exact', head: true }).eq('resolved', false).lte('due_on', today),
      supabase.from('flashcards').select('id', { count: 'exact', head: true }).lte('due_on', today),
    ]);
    return { errors: e.count ?? 0, cards: f.count ?? 0 };
  },
});

export interface Flashcard { id: string; kind: 'mnemonic' | 'question'; front: string; back: string; box: number; due_on: string }
export const useFlashcards = (all: boolean) => useQuery({
  queryKey: ['flashcards', all],
  queryFn: async () => {
    let q = supabase.from('flashcards').select('id, kind, front, back, box, due_on').order('due_on').limit(300);
    if (!all) q = q.lte('due_on', ymd(new Date()));
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data as Flashcard[];
  },
});
// Leitner: acertou sobe de caixa (1, 2, 4, 8 e 16 dias); errou volta para a caixa 1 (amanhã).
const BOX_DAYS = [1, 2, 4, 8, 16];
export async function reviewCard(c: Flashcard, knew: boolean) {
  const box = knew ? Math.min(5, c.box + 1) : 1, due = new Date();
  due.setDate(due.getDate() + BOX_DAYS[box - 1]!);
  const { error } = await supabase.from('flashcards').update({ box, due_on: ymd(due) }).eq('id', c.id);
  if (error) throw new Error(error.message);
}
export async function deleteCard(id: string) { await supabase.from('flashcards').delete().eq('id', id); }

// ---------- simulados ----------
export interface SimuladoConfig { kind: 'concurso' | 'custom'; blocks: { name: string; minPct: number; subjects: { name: string; count: number }[] }[]; timed: boolean; minutes: number; tipo?: string; banca?: string; missing?: string[] }
export interface SimuladoResult { total: number; correct: number; answered: number; pct: number; passed: boolean; seconds: number; blocks: { name: string; total: number; correct: number; pct: number; minPct: number; passed: boolean }[]; subjects: { name: string; total: number; correct: number; pct: number }[] }
export interface SimuladoRow { id: string; title: string; config: SimuladoConfig; status: 'in_progress' | 'finished'; started_at: string; finished_at: string | null; result: SimuladoResult | null; task_id: string | null }
export interface SimuladoData { simulado: SimuladoRow; questions: { qid: string; block: string; subject: string; question: Question | null; gabarito: string | null }[]; answers: { qid: string; chosen: string; struck: string[] }[] }

export const createSimulado = (body: Record<string, unknown>) => practice<{ id: string; missing: string[] }>({ action: 'simulado_create', ...body });
export const getSimulado = (id: string) => practice<SimuladoData>({ action: 'simulado_get', id });
export const finishSimulado = (id: string) => practice<SimuladoData>({ action: 'simulado_finish', id });
export async function saveSimAnswer(simuladoId: string, qid: string, chosen: string, struck: string[]) {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from('simulado_answers').upsert({ owner_id: u.user?.id, simulado_id: simuladoId, qid, chosen, struck, updated_at: new Date().toISOString() }, { onConflict: 'simulado_id,qid' });
  if (error) throw new Error(error.message);
}
export const useSimulados = () => useQuery({
  queryKey: ['simulados'],
  queryFn: async () => {
    const { data, error } = await supabase.from('simulados').select('id, title, config, status, started_at, finished_at, result, task_id').order('started_at', { ascending: false }).limit(50);
    if (error) throw new Error(error.message);
    return data as SimuladoRow[];
  },
});

// ---------- desempenho por contexto ----------
export type Ctx = 'plan' | 'free' | 'simulado' | 'review';
export interface AttemptStat { context: Ctx; materia: string; assunto: string; correct: boolean; created_at: string; time_ms: number | null; error_reason: ErrorReason | null }
export const useAttemptStats = () => useQuery({
  queryKey: ['attempt-stats'],
  queryFn: async () => {
    const { data, error } = await supabase.from('question_attempts').select('context, materia, assunto, correct, created_at, time_ms, error_reason').order('created_at', { ascending: false }).limit(5000);
    if (error) throw new Error(error.message);
    return data as AttemptStat[];
  },
});

// ---------- motivo do erro ----------
export async function lastErrorReason(qid: string) {
  const { data, error } = await supabase.from('question_attempts').select('error_reason').eq('qid', qid).eq('correct', false).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { error_reason: ErrorReason | null } | null)?.error_reason ?? null;
}
export async function setErrorReason(qid: string, reason: ErrorReason | null) {
  const { error } = await supabase.rpc('set_error_reason', { p_qid: qid, p_reason: reason });
  if (error) throw new Error(error.message);
}
