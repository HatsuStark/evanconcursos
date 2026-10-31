// Metas semanais e constância. As metas saem do cronograma: o que está previsto para a semana (segunda a domingo),
// contra o que foi feito nela, seja qual for a data da tarefa. Tarefa adiantada ou atrasada conta na semana em que foi feita.
import { parseYmd, ymd } from './dates.ts';

export const ACTIVITY_LOOKBACK_DAYS = 400;
const MIN_ACTIVE_SECONDS = 60; // abrir e fechar o cronômetro não é um dia de estudo

export interface DayActivity { day: string; seconds: number; questions: number; tasks_done: number; discursives: number }
export interface GoalTask { date: string; minutes: number; kind: string; goal_questions: number }

const addDays = (day: string, n: number) => { const d = parseYmd(day)!; d.setDate(d.getDate() + n); return ymd(d); };
const weekdayIndex = (day: string) => (parseYmd(day)!.getDay() + 6) % 7; // segunda = 0
const isActive = (a: DayActivity | undefined) => !!a && (a.seconds >= MIN_ACTIVE_SECONDS || a.questions > 0 || a.tasks_done > 0 || a.discursives > 0);

export const activityStart = (today: string) => addDays(today, -ACTIVITY_LOOKBACK_DAYS);

export function weeklyGoals(tasks: GoalTask[], activity: DayActivity[], today: string) {
  const start = addDays(today, -weekdayIndex(today)), end = addDays(start, 6);
  const planned = tasks.filter((t) => t.date >= start && t.date <= end && t.kind !== 'exam');
  const done = activity.filter((a) => a.day >= start && a.day <= end);
  const sum = <T,>(list: T[], f: (x: T) => number) => list.reduce((n, x) => n + f(x), 0);
  return {
    start, end,
    minutes: { done: Math.floor(sum(done, (a) => a.seconds) / 60), goal: sum(planned, (t) => t.minutes) },
    questions: { done: sum(done, (a) => a.questions), goal: sum(planned, (t) => t.goal_questions) },
    tasks: { done: sum(done, (a) => a.tasks_done), goal: planned.length },
  };
}

// Dias seguidos de estudo até hoje. Hoje ainda sem estudo não quebra a sequência, nem a folga prevista no
// questionário (hours: horas de segunda a domingo); folga em que estudou também conta.
export function studyStreak(activity: DayActivity[], hours: number[], today: string) {
  const byDay = new Map(activity.map((a) => [a.day, a]));
  let streak = 0;
  for (let i = 0; i <= ACTIVITY_LOOKBACK_DAYS; i++) {
    const day = addDays(today, -i);
    if (isActive(byDay.get(day))) streak++;
    else if (i > 0 && (hours[weekdayIndex(day)] ?? 0) > 0) break;
  }
  return streak;
}

// Os sete dias da semana atual, para a faixa de constância.
export function weekDays(activity: DayActivity[], hours: number[], today: string) {
  const byDay = new Map(activity.map((a) => [a.day, a])), start = addDays(today, -weekdayIndex(today));
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(start, i);
    return { day, active: isActive(byDay.get(day)), rest: (hours[i] ?? 0) === 0, isToday: day === today, future: day > today };
  });
}
