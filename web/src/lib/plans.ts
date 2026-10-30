// Planos de estudo: geração (IA no backend + scheduler determinístico) e leitura do cronograma ativo.
import { useQuery } from '@tanstack/react-query';
import { ymd } from '../../../shared/domain/dates.ts';
import type { Replan, ReplanAttempt } from '../../../shared/domain/replan.ts';
import { buildPlanPayload, calendarSummary, GENERATOR_VERSION, theoryPlan, type PlanBase } from '../../../shared/ai/plan-build.ts';
import { fallbackSessions, PLAN_PROMPT_VERSION, type PlanInputs, type Session } from '../../../shared/ai/plan.ts';
import { supabase } from './supabase.ts';

const must = <T,>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

export interface Strategy { advice: string[]; subjects: { subjectId: string; weight: number; focus: string }[]; fallbacks?: string[] }
export interface TaskRow {
  id: string; date: string; minutes: number; kind: string; subject_id: string | null; session_id: string | null;
  title: string; keyword: string; goal_questions: number; done_at: string | null;
}
export interface SubjectRow { id: string; name: string; position: number; is_core: boolean; questions: number; weight: number }

// Chamada a uma Edge Function com a mensagem de erro do servidor; 429 (limite da IA) espera e tenta de novo.
async function invoke<T>(name: string, body: Record<string, unknown>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (!error) return data as T;
    const ctx = (error as { context?: Response }).context;
    let msg = error.message;
    try { msg = (await ctx?.json())?.error ?? msg; } catch { /* sem JSON */ }
    if (i < tries && (ctx?.status === 429 || ctx?.status === 502)) { await new Promise((r) => setTimeout(r, ctx?.status === 429 ? 20000 : 3000)); continue; }
    throw new Error(msg);
  }
}

// Executa tarefas com no máximo `n` em paralelo.
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => { while (queue.length) await fn(queue.shift()!); }));
}

export type GenProgress = { step: 'strategy' | 'sessions' | 'saving'; done: number; total: number };

// Gera e grava uma nova versão do cronograma. Se a IA falhar numa matéria, ela usa as sessões montadas
// direto dos tópicos (o plano nunca fica pela metade) e isso fica registrado na estratégia.
export async function generatePlan(noticeId: string, inputs: PlanInputs, onProgress: (p: GenProgress) => void) {
  const notice = must(await supabase.from('notices').select('id, title, exam_date, total_questions').eq('id', noticeId).single()) as { id: string; title: string; exam_date: string | null; total_questions: number };
  if (!notice.exam_date) throw new Error('Defina a data da prova na conferência do edital.');
  const subs = must(await supabase.from('notice_subjects').select('id, name, is_core, questions, weight, notice_topics(id, text, position)').eq('notice_id', noticeId).order('position')) as
    (SubjectRow & { notice_topics: { id: string; text: string; position: number }[] })[];
  const base: PlanBase = {
    examDate: notice.exam_date, totalQuestions: notice.total_questions, inputs, weights: {},
    subjects: subs.map((s) => ({ id: s.id, name: s.name, core: s.is_core, questions: s.questions, weight: s.weight,
      topics: [...s.notice_topics].sort((a, b) => a.position - b.position).map((t) => ({ id: t.id, text: t.text })) })),
  };
  const cal = calendarSummary(base); // valida datas/horas antes de gastar IA

  onProgress({ step: 'strategy', done: 0, total: 1 });
  let strategy: Strategy = { advice: [], subjects: base.subjects.map((s) => ({ subjectId: s.id, weight: s.weight, focus: '' })), fallbacks: [] };
  try {
    strategy = { ...(await invoke<{ strategy: Strategy }>('plan-design', { step: 'strategy', noticeId, inputs, weeks: cal.weeks, hours: cal.hours })).strategy, fallbacks: [] };
  } catch (e) {
    strategy.fallbacks!.push(`estratégia: ${(e as Error).message}`);
  }
  for (const s of strategy.subjects) base.weights[s.subjectId] = s.weight;

  const counts = theoryPlan(base), sessions: Record<string, Session[]> = {};
  let done = 0;
  onProgress({ step: 'sessions', done, total: base.subjects.length });
  await pool(base.subjects, 4, async (s) => {
    const n = counts[s.id]!.days;
    try {
      const r = await invoke<{ sessions: Session[] }>('plan-design', {
        step: 'sessions', noticeId, subjectId: s.id, n, minutes: counts[s.id]!.avgMinutes,
        level: inputs.levels[s.id] ?? 1, profile: inputs.profile, focus: strategy.subjects.find((x) => x.subjectId === s.id)?.focus ?? '',
      });
      if (r.sessions.length !== n) throw new Error('quantidade de sessões diferente da pedida');
      sessions[s.id] = r.sessions;
    } catch (e) {
      sessions[s.id] = fallbackSessions(s.topics.map((t) => t.text), n);
      strategy.fallbacks!.push(`${s.name}: ${(e as Error).message}`);
    }
    onProgress({ step: 'sessions', done: ++done, total: base.subjects.length });
  });

  onProgress({ step: 'saving', done: 0, total: 1 });
  const payload = buildPlanPayload(base, sessions);
  const { data, error } = await supabase.rpc('create_plan_version', {
    p_notice_id: noticeId,
    p_data: { name: notice.title, from: ymd(new Date()), inputs, strategy, summary: payload.summary, generatorVersion: GENERATOR_VERSION, promptVersion: PLAN_PROMPT_VERSION, sessions: payload.sessions, tasks: payload.tasks },
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export interface ActivePlan {
  plan: { id: string; name: string; notice_id: string; active_version_id: string | null };
  notice: { id: string; role_name: string; organization: string; board: string; exam_date: string | null };
  version: { id: string; number: number; reason: string; inputs: PlanInputs; strategy: Strategy; summary: { weeks?: number; hours?: number; perSubject?: { subjectId: string; name: string; days: number }[] }; created_at: string } | null;
  subjects: SubjectRow[];
  tasks: TaskRow[];
}

// Plano ativo mais recente (com o edital, a versão ativa, as matérias e as tarefas vigentes).
export const useActivePlan = (noticeId?: string) => useQuery({
  queryKey: ['active-plan', noticeId ?? 'latest'],
  queryFn: async (): Promise<ActivePlan | null> => {
    let q = supabase.from('study_plans').select('id, name, notice_id, active_version_id').eq('status', 'active').order('created_at', { ascending: false }).limit(1);
    if (noticeId) q = q.eq('notice_id', noticeId);
    const plan = (must(await q) as ActivePlan['plan'][])[0];
    if (!plan) return null;
    const [notice, version, subjects, tasks] = await Promise.all([
      supabase.from('notices').select('id, role_name, organization, board, exam_date').eq('id', plan.notice_id).single(),
      plan.active_version_id ? supabase.from('plan_versions').select('id, number, reason, inputs, strategy, summary, created_at').eq('id', plan.active_version_id).single() : Promise.resolve({ data: null, error: null }),
      supabase.from('notice_subjects').select('id, name, position, is_core, questions, weight').eq('notice_id', plan.notice_id).order('position'),
      supabase.from('tasks').select('id, date, minutes, kind, subject_id, session_id, title, keyword, goal_questions, done_at')
        .eq('plan_id', plan.id).is('superseded_in_version', null).order('date').order('position').limit(5000),
    ]);
    return { plan, notice: must(notice) as ActivePlan['notice'], version: must(version) as ActivePlan['version'], subjects: must(subjects) as SubjectRow[], tasks: must(tasks) as TaskRow[] };
  },
});

// Reorganização depois de atrasos: tudo calculado no app, sem IA; o banco grava a nova versão.
export const usePlanAttempts = (planId: string | undefined, enabled: boolean) => useQuery({
  queryKey: ['plan-attempts', planId],
  enabled: enabled && !!planId,
  queryFn: async () => must(await supabase.from('question_attempts').select('subject_id, correct, error_reason, created_at').eq('plan_id', planId!).not('subject_id', 'is', null).order('created_at', { ascending: false }).limit(5000)) as ReplanAttempt[],
});

export async function applyReplan(planId: string, r: Replan) {
  const { error } = await supabase.rpc('replan_version', { p_plan: planId, p_data: r });
  if (error) throw new Error(error.message);
}

export async function setTaskDone(taskId: string, done: boolean) {
  const { error } = await supabase.from('tasks').update({ done_at: done ? new Date().toISOString() : null }).eq('id', taskId);
  if (error) throw new Error(error.message);
}

export const KIND_LABEL: Record<string, string> = {
  theory: 'Teoria', consolidation: 'Consolidação', final_review: 'Revisão final', weekly_review: 'Revisão semanal',
  simulado: 'Simulado', eve: 'Véspera', exam: 'Prova',
};
export const today = () => ymd(new Date());
