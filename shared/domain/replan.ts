// Reorganiza o cronograma depois de atrasos, de forma determinística e sem IA. O que está feito não muda; toda
// sessão de teoria pendente continua no plano, na mesma ordem. O espaço para as atrasadas vem primeiro dos dias de
// consolidação, depois da revisão final e da revisão semanal; simulados, véspera e prova não saem do lugar. Só se
// ainda faltar espaço, um dia recebe mais de uma sessão. Os dias de reforço restantes vão para as matérias mais fracas.
import { HALF_LIFE_DAYS, PRIOR, PRIOR_WEIGHT } from './adaptive.ts';
import { DAY_MS } from './dates.ts';
import { apportion, interleave } from './scheduler.ts';

export const ERROR_REASONS = [
  { key: 'conteudo', label: 'Falta de conteúdo' },
  { key: 'atencao', label: 'Falta de atenção' },
  { key: 'pegadinha', label: 'Caí na pegadinha' },
] as const;
export type ErrorReason = (typeof ERROR_REASONS)[number]['key'];

export interface ReplanTask {
  id: string; date: string; minutes: number; kind: string; subject_id: string | null; session_id: string | null;
  title: string; keyword: string; goal_questions: number; done_at: string | null;
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
        else add(day, s, p, minutes, Math.round(minutes / 6));
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

  // Revisão semanal que não virou teoria, simulado, véspera e prova ficam como estão; o que passou sem ser feito sai.
  for (const t of open) if (['weekly_review', 'simulado', 'eve', 'exam'].includes(t.kind) && !taken.has(t.id)) kept.add(t.id);
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
