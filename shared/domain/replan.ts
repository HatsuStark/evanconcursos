// Reorganiza o cronograma depois de atrasos, de forma determinística e sem IA. O que está feito não muda; toda
// sessão de teoria pendente continua no plano, na mesma ordem. O espaço para as atrasadas vem primeiro dos dias de
// consolidação, depois da revisão final e da revisão semanal; simulados, véspera e prova não saem do lugar. Só se
// ainda faltar espaço, um dia recebe mais de uma sessão. Os dias de reforço restantes vão para as matérias mais fracas.
import { HALF_LIFE_DAYS, PRIOR, PRIOR_WEIGHT } from './adaptive.ts';
import { DAY_MS } from './dates.ts';
import { apportion, interleave, theoryGoal } from './scheduler.ts';

export const ERROR_REASONS = [
  { key: 'conteudo', label: 'Falta de conteúdo' },
  { key: 'atencao', label: 'Falta de atenção' },
  { key: 'pegadinha', label: 'Caí na pegadinha' },
] as const;
export type ErrorReason = (typeof ERROR_REASONS)[number]['key'];

export interface ReplanTask {
  id: string; date: string; minutes: number; kind: string; subject_id: string | null; session_id: string | null;
  title: string; keyword: string; goal_questions: number; done_at: string | null; position?: number;
}
export interface ReplanSubject { id: string; weight: number }
export interface ReplanAttempt { subject_id: string | null; correct: boolean; error_reason: string | null; created_at: string }
export interface NewTask {
  date: string; position: number; minutes: number; kind: string; subjectId: string | null; sessionId: string | null;
  title: string; keyword: string; goal: number; fromTaskId: string | null;
}
export interface ReplanSummary {
  overdueTheory: number; overdueOther: number; absorbed: { consolidation: number; final_review: number; weekly_review: number };
  crowdedDays: number; unplaced: number; weakest: string[];
}
export interface Replan { supersede: string[]; tasks: NewTask[]; summary: ReplanSummary }

// Erro por falta de atenção conta metade: revela menos falta de domínio da matéria do que os outros motivos.
const ATTENTION_WRONG = 0.5;

// Fraqueza de cada matéria de 0 a 1: acerto suavizado e com meia-vida, como no foco adaptativo.
export function subjectWeakness(subjects: ReplanSubject[], attempts: ReplanAttempt[], now: number) {
  const totals = new Map(subjects.map((s) => [s.id, { wrong: 0, all: 0, count: 0 }]));
  for (const a of attempts) {
    const e = a.subject_id ? totals.get(a.subject_id) : undefined;
    if (!e) continue;
    const w = Math.pow(0.5, Math.max(0, now - new Date(a.created_at).getTime()) / DAY_MS / HALF_LIFE_DAYS);
    e.all += w; e.count++;
    if (!a.correct) e.wrong += w * (a.error_reason === 'atencao' ? ATTENTION_WRONG : 1);
  }
  return new Map([...totals].map(([id, e]) => [id, { weakness: (e.wrong + (1 - PRIOR) * PRIOR_WEIGHT) / (e.all + PRIOR_WEIGHT), count: e.count }]));
}

// Meta da sessão movida: a mesma fase do plano (questões por minuto da meta original), no tempo do novo dia. Tarefa sem
// meta gravada volta à meta da primeira fase.
export const movedGoal = (t: Pick<ReplanTask, 'goal_questions' | 'minutes'>, minutes: number) =>
  t.goal_questions > 0 && t.minutes > 0 ? Math.max(5, Math.round((t.goal_questions * minutes) / t.minutes)) : theoryGoal(minutes);

// Tarefas de teoria atrasadas: nenhuma se perde, e por isso são elas que pedem a reorganização.
export const overdueTasks = (tasks: ReplanTask[], today: string) => tasks.filter((t) => !t.done_at && t.date < today && t.kind !== 'exam');

export function replan(tasks: ReplanTask[], subjects: ReplanSubject[], attempts: ReplanAttempt[], today: string, now = Date.now()): Replan {
  const byDate = (a: ReplanTask, b: ReplanTask) => a.date.localeCompare(b.date);
  const pending = tasks.filter((t) => !t.done_at).sort(byDate);
  const sessions = pending.filter((t) => t.kind === 'theory');
  const open = pending.filter((t) => t.date >= today);
  const ofKind = (kind: string) => open.filter((t) => t.kind === kind);

  // Dias que recebem teoria: os de teoria e, faltando espaço, os de reforço e revisão.
  const absorbed = { consolidation: 0, final_review: 0, weekly_review: 0 };
  const taken = new Set<string>();
  let missing = sessions.length - ofKind('theory').length;
  for (const kind of ['consolidation', 'final_review', 'weekly_review'] as const) {
    for (const t of ofKind(kind)) {
      if (missing <= 0) break;
      taken.add(t.id); absorbed[kind]++; missing--;
    }
  }
  const days = open.filter((t) => t.kind === 'theory' || taken.has(t.id));

  const out: NewTask[] = [], kept = new Set<string>();
  const add = (slot: ReplanTask, from: ReplanTask, position: number, minutes: number, goal: number) => out.push({
    date: slot.date, position, minutes, kind: from.kind, subjectId: from.subject_id, sessionId: from.session_id,
    title: from.title, keyword: from.keyword, goal, fromTaskId: from.id,
  });

  // Distribui as sessões pelos dias, na ordem; sem nenhum dia livre, ficam atrasadas onde estão.
  let crowdedDays = 0;
  if (days.length) {
    const per = Math.floor(sessions.length / days.length), extra = sessions.length % days.length;
    let next = 0;
    days.forEach((day, i) => {
      const size = per + (i < extra ? 1 : 0);
      if (size > 1) crowdedDays++;
      const minutes = Math.floor(day.minutes / Math.max(1, size));
      for (let p = 0; p < size; p++) {
        const s = sessions[next++]!;
        if (size === 1 && s.date === day.date) kept.add(s.id);
        else add(day, s, p, minutes, movedGoal(s, minutes));
      }
    });
  } else for (const s of sessions) kept.add(s.id);

  // Reforço: as matérias mais fracas recebem mais dias, sem perder de vista o peso de cada uma no edital.
  const weak = subjectWeakness(subjects, attempts, now);
  const weights = subjects.map((s) => s.weight * (0.5 + 2 * weak.get(s.id)!.weakness));
  for (const kind of ['consolidation', 'final_review']) {
    const rest = ofKind(kind).filter((t) => !taken.has(t.id));
    if (!rest.length || !subjects.length) continue;
    const seq = interleave(apportion(weights, Math.max(rest.length, subjects.length)));
    rest.forEach((t, i) => {
      const subjectId = subjects[seq[i]!]!.id;
      if (subjectId === t.subject_id) kept.add(t.id);
      else add(t, { ...t, subject_id: subjectId }, 0, t.minutes, t.goal_questions);
    });
  }

  // Revisão semanal que não virou teoria, lei seca, simulado, véspera e prova ficam como estão; o que passou sem ser feito sai.
  for (const t of open) if (['weekly_review', 'pente_fino', 'lei_seca', 'simulado', 'eve', 'exam'].includes(t.kind) && !taken.has(t.id)) kept.add(t.id);
  const overdue = overdueTasks(tasks, today);
  const weakest = subjects.filter((s) => weak.get(s.id)!.count >= 5).sort((a, b) => weak.get(b.id)!.weakness - weak.get(a.id)!.weakness).slice(0, 2).map((s) => s.id);
  return {
    supersede: pending.filter((t) => !kept.has(t.id)).map((t) => t.id),
    tasks: out,
    summary: {
      overdueTheory: overdue.filter((t) => t.kind === 'theory').length,
      overdueOther: overdue.filter((t) => t.kind !== 'theory').length,
      absorbed, crowdedDays, unplaced: days.length ? 0 : sessions.length, weakest,
    },
  };
}

// ---------- rebalanceamento a cada 2 semanas (plano com data) ----------
// Os blocos futuros de reforço e de revisão final mudam de matéria conforme o desempenho: mais tempo onde há mais pontos a
// ganhar até a meta (questões na prova × distância até a meta) e prioridade a quem está abaixo da nota mínima eliminatória.
// A teoria não muda: a ordem das sessões continua a mesma.
export const REBALANCE_EVERY_DAYS = 14;
const REBALANCE_MIN_ATTEMPTS = 20;
const BELOW_MIN_BOOST = 1.5;
const REBALANCE_KINDS = ['consolidation', 'final_review'];

export interface RebalanceSubject { id: string; questions: number; weight: number; minPct?: number }
export interface RebalanceSummary { kind: 'rebalance'; at: string; changed: number; focus: { subjectId: string; rate: number }[] }

export function rebalance(tasks: ReplanTask[], subjects: RebalanceSubject[], attempts: ReplanAttempt[], goal: { target: number }, today: string, now = Date.now()) {
  if (attempts.filter((a) => a.subject_id).length < REBALANCE_MIN_ATTEMPTS || !subjects.length) return null;
  const open = tasks.filter((t) => !t.done_at && t.date >= today && REBALANCE_KINDS.includes(t.kind)).sort((a, b) => a.date.localeCompare(b.date));
  if (!open.length) return null;
  const weak = subjectWeakness(subjects, attempts, now);
  const rate = (id: string) => 1 - weak.get(id)!.weakness;
  const demand = subjects.map((s) => {
    const stake = Math.pow(Math.max(1, s.questions || 5) * Math.max(1, s.weight), 0.75);
    return stake * Math.max(0.05, goal.target - rate(s.id)) * (s.minPct && rate(s.id) < s.minPct / 100 ? BELOW_MIN_BOOST : 1);
  });
  const order = interleave(apportion(demand, Math.max(open.length, subjects.length)));
  // No mesmo dia, matérias diferentes sempre que der.
  const usedIn = new Map<string, Set<string>>(), out: NewTask[] = [], supersede: string[] = [];
  for (const t of open) {
    const used = usedIn.get(t.date) ?? new Set(tasks.filter((x) => x.date === t.date && !REBALANCE_KINDS.includes(x.kind) && x.subject_id).map((x) => x.subject_id!));
    let k = order.findIndex((si) => !used.has(subjects[si]!.id));
    if (k < 0) k = 0;
    const subjectId = subjects[order.splice(k, 1)[0]!]!.id;
    used.add(subjectId); usedIn.set(t.date, used);
    if (subjectId === t.subject_id) continue;
    supersede.push(t.id);
    out.push({ date: t.date, position: t.position ?? 0, minutes: t.minutes, kind: t.kind, subjectId, sessionId: null, title: t.title, keyword: t.keyword, goal: t.goal_questions, fromTaskId: t.id });
  }
  if (!out.length) return null;
  const focus = subjects.map((s, i) => ({ subjectId: s.id, rate: Math.round(rate(s.id) * 100), d: demand[i]! })).sort((a, b) => b.d - a.d).slice(0, 2).map(({ subjectId, rate: r }) => ({ subjectId, rate: r }));
  const summary: RebalanceSummary = { kind: 'rebalance', at: today, changed: out.length, focus };
  return { supersede, tasks: out, summary };
}
