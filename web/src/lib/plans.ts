// Planos de estudo: geração (IA no backend + scheduler determinístico) e leitura do cronograma ativo.
import { useQuery } from '@tanstack/react-query';
import { subjectMinPct } from '../../../shared/domain/adaptive.ts';
import { ymd } from '../../../shared/domain/dates.ts';
import { prioritize, RUSH_WEEKS } from '../../../shared/domain/priority.ts';
import type { PrioritizeSummary } from '../../../shared/domain/coverage.ts';
import type { RebalanceSummary, Replan } from '../../../shared/domain/replan.ts';
import { isOpenEnded, openEndDate, type RoundAttempt, type RoundSummary } from '../../../shared/domain/rounds.ts';
import { buildPlanPayload, calendarSummary, carryOverSessions, GENERATOR_VERSION, theoryPlan, type PlanBase } from '../../../shared/ai/plan-build.ts';
import { fallbackSessions, PLAN_PROMPT_VERSION, type PlanInputs, type Session } from '../../../shared/ai/plan.ts';
import { remapMaterial, type Material } from './materials.ts';
import { loadNoticeUpdate, type Draft } from './notices.ts';
import { supabase } from './supabase.ts';

const must = <T,>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

export interface Strategy { advice: string[]; subjects: { subjectId: string; weight: number; focus: string }[]; fallbacks?: string[] }
export interface TaskRow {
  id: string; date: string; minutes: number; kind: string; subject_id: string | null; session_id: string | null;
  title: string; keyword: string; goal_questions: number; done_at: string | null; position?: number;
}
export interface SubjectRow { id: string; name: string; position: number; is_core: boolean; questions: number; weight: number; block?: string }

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

// Busca (no servidor) o texto das normas citadas no edital que o app ainda não tem: federais no normas.leg.br, estaduais
// no acervo ctresb/leis. Rápida quando já foram achadas antes, por qualquer estudante.
export const resolveNoticeLaws = (noticeId: string) => invoke<{ found: string[]; missing: string[] }>('plan-design', { step: 'laws', noticeId }, 1);

export type GenProgress ={ step: 'strategy' | 'sessions' | 'saving' | 'materials'; done: number; total: number };

// Gera e grava uma nova versão do cronograma. Se a IA falhar numa matéria, ela usa as sessões montadas
// direto dos tópicos (o plano nunca fica pela metade) e isso fica registrado na estratégia.
// Com `carry` (novo edital), o conteúdo novo vem antes, o já estudado vira revisão, e edital sem data fica sem prazo.
export async function generatePlan(noticeId: string, inputs: PlanInputs, onProgress: (p: GenProgress) => void, carry?: { studied: Set<string> }) {
  const notice = must(await supabase.from('notices').select('id, title, exam_date, total_questions, structure').eq('id', noticeId).single()) as { id: string; title: string; exam_date: string | null; total_questions: number; structure: { blocks?: { name: string; rule: string; questions: number }[] } | null };
  if (!notice.exam_date && !carry) throw new Error('Defina a data da prova na conferência do edital.');
  const subs = must(await supabase.from('notice_subjects').select('id, name, block, is_core, questions, weight, notice_topics(id, text, position)').eq('notice_id', noticeId).order('position')) as
    (SubjectRow & { block: string; notice_topics: { id: string; text: string; position: number }[] })[];
  // Prova já realizada: plano sem prazo, com a primeira volta dimensionada pelo tamanho do conteúdo.
  const openEnded = isOpenEnded(notice.exam_date, ymd(new Date())) || !notice.exam_date;
  const base: PlanBase = {
    examDate: openEnded ? openEndDate(inputs.startDate, inputs.hours, inputs.weeklyReview, subs.map((s) => s.notice_topics.length)) : notice.exam_date!,
    openEnded, totalQuestions: notice.total_questions, inputs, weights: {}, blocks: notice.structure?.blocks ?? [],
    subjects: subs.map((s) => ({ id: s.id, name: s.name, core: s.is_core, questions: s.questions, weight: s.weight, minPct: subjectMinPct(s.block, notice.structure?.blocks ?? []) || undefined, block: s.block,
      topics: [...s.notice_topics].sort((a, b) => a.position - b.position).map((t) => ({ id: t.id, text: t.text })) })),
  };
  const cal = calendarSummary(base); // valida datas/horas antes de gastar IA

  onProgress({ step: 'strategy', done: 0, total: 1 });
  // Texto das normas do edital fora do registro, para as sessões delas serem medidas. Falha não impede o plano.
  await resolveNoticeLaws(noticeId).catch(() => null);
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

  // Prazo curto: em cada matéria, os temas mais cobrados primeiro (partes juntas, aprofundamentos no lugar).
  if (!openEnded && cal.weeks <= RUSH_WEEKS) {
    for (const s of base.subjects) sessions[s.id] = prioritize(sessions[s.id]!);
    strategy.advice = [...strategy.advice, `Prazo curto (${cal.weeks} semanas): em cada matéria, os temas mais cobrados vêm primeiro, para o principal estar visto se o tempo acabar.`];
  }

  onProgress({ step: 'saving', done: 0, total: 1 });
  const review: Record<string, Set<number>> = {};
  if (carry) {
    for (const s of base.subjects) {
      const r = carryOverSessions(sessions[s.id]!, s.topics.map((t) => t.id), carry.studied);
      sessions[s.id] = r.sessions; review[s.id] = r.review;
    }
  }
  const payload = buildPlanPayload(base, sessions, review);
  const { data, error } = await supabase.rpc('create_plan_version', {
    p_notice_id: noticeId,
    p_data: { name: notice.title, from: ymd(new Date()), inputs, strategy, summary: { ...payload.summary, openEnded }, generatorVersion: GENERATOR_VERSION, promptVersion: PLAN_PROMPT_VERSION, sessions: payload.sessions, tasks: payload.tasks },
  });
  if (error) throw new Error(error.message);
  // Sem prazo, as tarefas são uma fila: não há dia fixo nem atraso.
  if (openEnded) must(await supabase.from('study_plans').update({ pacing: 'ciclo' }).eq('notice_id', noticeId));
  return data as string;
}

// Novo edital: gera o plano dele, arquiva o antigo e leva o desempenho (se a banca for a mesma) e as apostilas, que são
// mapeadas de novo. Devolve quantas apostilas não puderam ser mapeadas; elas continuam em Meus materiais.
export async function updatePlanFromNotice(noticeId: string, inputs: PlanInputs, onProgress: (p: GenProgress) => void) {
  const update = await loadNoticeUpdate(noticeId);
  if (!update) throw new Error('Este edital não está ligado a um plano anterior.');
  await generatePlan(noticeId, inputs, onProgress, { studied: update.studiedTopics });
  const { error } = await supabase.rpc('adopt_notice_update', { p_notice: noticeId, p_subjects: update.diff.boardChanged ? {} : update.subjects });
  if (error) throw new Error(error.message);
  const plan = must(await supabase.from('study_plans').select('id').eq('notice_id', noticeId).eq('status', 'active').single()) as { id: string };
  const materials = must(await supabase.from('materials').select('id, title, storage_path, pages, status, status_detail, size_bytes, created_at').eq('plan_id', plan.id)) as Material[];
  let failed = 0;
  for (const [i, m] of materials.entries()) {
    onProgress({ step: 'materials', done: i, total: materials.length });
    try { await remapMaterial(m); } catch { failed++; }
  }
  return failed;
}

export type Pacing = 'agenda' | 'ciclo';
export interface ActivePlan {
  plan: { id: string; name: string; notice_id: string; active_version_id: string | null; pacing: Pacing };
  notice: { id: string; role_name: string; organization: string; board: string; exam_date: string | null; total_questions: number; education_level: Draft['educationLevel']; cutoff_pct: number | null; role_duties: string; structure: { blocks?: { name: string; rule: string }[] } | null };
  version: { id: string; number: number; reason: string; inputs: PlanInputs; strategy: Strategy; summary: { weeks?: number; hours?: number; perSubject?: { subjectId: string; name: string; days: number }[]; replan?: { round?: RoundSummary } & (Partial<RebalanceSummary> | Partial<PrioritizeSummary>); openEnded?: boolean }; created_at: string } | null;
  subjects: SubjectRow[];
  tasks: TaskRow[];
  openEnded: boolean; // prova já realizada: plano sem prazo, que se adapta ao desempenho
}

// Plano ativo do edital pedido ou, sem edital, do concurso ativo (escolhido na aba Concursos; sem escolha, o mais
// recente), com o edital, a versão ativa, as matérias e as tarefas vigentes.
export const useActivePlan = (noticeId?: string) => useQuery({
  queryKey: ['active-plan', noticeId ?? 'current'],
  queryFn: async (): Promise<ActivePlan | null> => {
    let q = supabase.from('study_plans').select('id, name, notice_id, active_version_id, pacing').eq('status', 'active').order('created_at', { ascending: false }).limit(1);
    if (noticeId) q = q.eq('notice_id', noticeId);
    else {
      const { data: current, error } = await supabase.rpc('my_active_plan');
      if (error) throw new Error(error.message);
      if (!current) return null;
      q = q.eq('id', current as string);
    }
    const plan = (must(await q) as ActivePlan['plan'][])[0];
    if (!plan) return null;
    // Dias de aprofundamento que chegaram: o tema é escolhido agora, pela sessão em que o estudante mais erra.
    await supabase.rpc('bind_adaptive_sessions', { p_plan: plan.id });
    const [notice, version, subjects, tasks] = await Promise.all([
      supabase.from('notices').select('id, role_name, organization, board, exam_date, total_questions, education_level, cutoff_pct, role_duties, structure').eq('id', plan.notice_id).single(),
      plan.active_version_id ? supabase.from('plan_versions').select('id, number, reason, inputs, strategy, summary, created_at').eq('id', plan.active_version_id).single() : Promise.resolve({ data: null, error: null }),
      supabase.from('notice_subjects').select('id, name, position, is_core, questions, weight, block').eq('notice_id', plan.notice_id).order('position'),
      supabase.from('tasks').select('id, date, position, minutes, kind, subject_id, session_id, title, keyword, goal_questions, done_at')
        .eq('plan_id', plan.id).is('superseded_in_version', null).order('date').order('position').limit(5000),
    ]);
    const noticeRow = must(notice) as ActivePlan['notice'], versionRow = must(version) as ActivePlan['version'];
    const openEnded = isOpenEnded(noticeRow.exam_date, ymd(new Date())) || (!noticeRow.exam_date && !!versionRow?.summary.openEnded);
    return { plan: openEnded ? { ...plan, pacing: 'ciclo' } : plan, notice: noticeRow, version: versionRow, subjects: must(subjects) as SubjectRow[], tasks: must(tasks) as TaskRow[], openEnded };
  },
});

// Concurso ativo: o app inteiro (início, questões, caderno de erros, flashcards, simulados, metas) passa a usar o plano dele.
export async function setActiveNotice(noticeId: string) {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from('profiles').update({ active_notice_id: noticeId }).eq('id', u.user!.id);
  if (error) throw new Error(error.message);
}

// Reorganização depois de atrasos: tudo calculado no app, sem IA; o banco grava a nova versão.
export const usePlanAttempts = (planId: string | undefined, enabled: boolean) => useQuery({
  queryKey: ['plan-attempts', planId],
  enabled: enabled && !!planId,
  queryFn: async () => must(await supabase.from('question_attempts').select('subject_id, session_id, correct, error_reason, created_at').eq('plan_id', planId!).not('subject_id', 'is', null).order('created_at', { ascending: false }).limit(5000)) as RoundAttempt[],
});

export async function applyReplan(planId: string, r: Pick<Replan, 'supersede' | 'tasks'> & { summary: unknown }) {
  const { error } = await supabase.rpc('replan_version', { p_plan: planId, p_data: r });
  if (error) throw new Error(error.message);
}

export async function setPacing(planId: string, pacing: Pacing) {
  const { error } = await supabase.from('study_plans').update({ pacing }).eq('id', planId);
  if (error) throw new Error(error.message);
}

export async function setTaskDone(taskId: string, done: boolean) {
  const { error } = await supabase.from('tasks').update({ done_at: done ? new Date().toISOString() : null }).eq('id', taskId);
  if (error) throw new Error(error.message);
}

export const KIND_LABEL: Record<string, string> = {
  theory: 'Teoria', consolidation: 'Reforço', final_review: 'Revisão final', pente_fino: 'Pente-fino', weekly_review: 'Revisão semanal', lei_seca: 'Lei seca',
  simulado: 'Simulado', eve: 'Véspera', exam: 'Prova',
};
export const today = () => ymd(new Date());

// Deixa prontas as apostilas das próximas sessões, no máximo uma vez por dia e plano. Falha aqui não atrapalha:
// a apostila é gerada ao abrir a sessão.
export function prepareGuides(planId: string) {
  const key = `guides-prepared:${planId}`, day = today();
  try {
    if (localStorage.getItem(key) === day) return;
    localStorage.setItem(key, day);
  } catch { return; }
  void supabase.functions.invoke('study-guide', { body: { action: 'prepare', planId } }).catch(() => {});
}

// Cobrança estimada de cada sessão do plano (1 a 3), para priorizar os temas quando o tempo aperta.
export const useSessionIncidence = (planId: string | undefined, enabled: boolean) => useQuery({
  queryKey: ['session-incidence', planId],
  enabled: enabled && !!planId,
  staleTime: 10 * 60_000,
  queryFn: async () => {
    const versions = must(await supabase.from('plan_versions').select('id').eq('plan_id', planId!)) as { id: string }[];
    const rows = versions.length ? must(await supabase.from('study_sessions').select('id, incidence').in('plan_version_id', versions.map((v) => v.id)).limit(5000)) as { id: string; incidence: number | null }[] : [];
    return new Map(rows.map((r) => [r.id, r.incidence ?? 2]));
  },
});
