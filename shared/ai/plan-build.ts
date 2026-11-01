// Montagem do cronograma: une as sessões (IA, já corrigidas) ao calendário determinístico do scheduler
// e produz o payload de create_plan_version. Duas passadas: a 1ª dá quantos dias de teoria cada matéria
// recebe (n de sessões pedido à IA); a 2ª encaixa as sessões, uma por dia, na ordem.
import { parseYmd, ymd } from '../domain/dates.ts';
import { generateSchedule, theoryGoal, topicKeyword, type DayKind, type ScheduleConfig, type ScheduleInput } from '../domain/scheduler.ts';
import type { PlanInputs, Session } from './plan.ts';

export const GENERATOR_VERSION = 'scheduler-v1';
export const REVIEW_PREFIX = 'Revisão: ';

export interface PlanSubject { id: string; name: string; core: boolean; questions: number; weight: number; topics: { id: string; text: string }[] }
export interface PlanBase { examDate: string; openEnded?: boolean; totalQuestions: number; subjects: PlanSubject[]; inputs: PlanInputs; weights: Record<string, number> }

export interface SessionRow { key: string; subjectId: string; position: number; title: string; keyword: string; topicIds: string[] }
export interface TaskRow { date: string; position: number; minutes: number; kind: Exclude<DayKind, '' | 'rest'>; subjectId: string | null; sessionKey: string | null; title: string; keyword: string; goal: number }

const TITLES: Partial<Record<DayKind, string>> = {
  consolidation: 'Questões dos pontos fracos', final_review: 'Revisão final dos pontos fracos',
  weekly_review: 'Revisão da semana e caderno de erros', simulado: 'Simulado completo + correção',
  eve: 'Revisão leve e descanso', exam: 'Dia da prova',
};

// No scheduler, as matérias são identificadas pelo id (nomes podem se repetir).
function scheduleArgs(b: PlanBase, topicsById: (id: string) => string[]): [ScheduleInput, ScheduleConfig] {
  return [
    { startDate: b.inputs.startDate, examDate: b.examDate, openEnded: b.openEnded, subjects: b.subjects.map((s) => ({ name: s.id, core: s.core })) },
    {
      hours: b.inputs.hours, weeklyReview: b.inputs.weeklyReview,
      subjects: Object.fromEntries(b.subjects.map((s) => [s.id, { weight: b.weights[s.id] ?? s.weight, level: b.inputs.levels[s.id] ?? 1, topics: topicsById(s.id) }])),
    },
  ];
}

// 1ª passada: dias de teoria por matéria e minutos médios por dia (para o prompt das sessões).
export function theoryPlan(b: PlanBase) { return firstPass(b).counts; }
// Semanas e horas totais do calendário (contexto para a estratégia da IA).
export function calendarSummary(b: PlanBase) { return firstPass(b).summary; }

function firstPass(b: PlanBase) {
  const sched = generateSchedule(...scheduleArgs(b, () => []));
  const minutes: Record<string, number[]> = {};
  for (const d of sched.weeks.flatMap((w) => w.days)) if (d.kind === 'theory') (minutes[d.subject] ??= []).push(d.hours * 60);
  const counts = Object.fromEntries(b.subjects.map((s) => {
    const m = minutes[s.id] ?? [];
    return [s.id, { days: m.length, avgMinutes: m.length ? Math.round(m.reduce((a, x) => a + x, 0) / m.length) : 120 }];
  })) as Record<string, { days: number; avgMinutes: number }>;
  return { counts, summary: sched.summary };
}

// Novo edital: em cada matéria, o conteúdo novo vem antes, e vira revisão a sessão cujos tópicos já foram todos estudados.
// `topicIds` são os tópicos do edital novo, na ordem em que as sessões os numeram.
export function carryOverSessions(list: Session[], topicIds: string[], studied: Set<string>) {
  const isKnown = (s: Session) => !!s.topics.length && s.topics.every((t) => { const id = topicIds[t]; return !!id && studied.has(id); });
  const ordered = [...list.filter((s) => !isKnown(s)), ...list.filter(isKnown)];
  return { sessions: ordered, review: new Set(ordered.flatMap((s, i) => (isKnown(s) ? [i] : []))) };
}

// 2ª passada: cronograma final com sessões. `sessions[subjectId]` precisa ter exatamente os dias da 1ª passada.
// `review`: sessões já estudadas, por matéria e posição, cuja tarefa é de revisão.
export function buildPlanPayload(b: PlanBase, sessions: Record<string, Session[]>, review: Record<string, Set<number>> = {}) {
  const counts = theoryPlan(b);
  for (const s of b.subjects) {
    if ((sessions[s.id]?.length ?? 0) !== counts[s.id]!.days) throw Error(`${s.name}: esperadas ${counts[s.id]!.days} sessões, vieram ${sessions[s.id]?.length ?? 0}.`);
  }
  const sched = generateSchedule(...scheduleArgs(b, (id) => sessions[id]!.map((x) => x.title)));
  const sessionRows: SessionRow[] = b.subjects.flatMap((s) => sessions[s.id]!.map((x, i) => ({
    key: `${s.id}:${i}`, subjectId: s.id, position: i, title: x.title, keyword: x.keyword || topicKeyword(x.title),
    topicIds: x.topics.map((t) => s.topics[t]?.id).filter((id): id is string => !!id),
  })));
  const monday = parseYmd(sched.startDate)!;
  const tasks: TaskRow[] = [];
  sched.weeks.forEach((w, wi) => w.days.forEach((d, di) => {
    if (d.kind === '' || d.kind === 'rest') return;
    const date = new Date(monday); date.setDate(monday.getDate() + wi * 7 + di);
    const subjectId = d.subject || null, session = d.kind === 'theory' && subjectId ? sessions[subjectId]![d.item] : undefined;
    tasks.push({
      date: ymd(date), position: 0, minutes: Math.round(d.hours * 60), kind: d.kind, subjectId,
      sessionKey: session ? `${subjectId}:${d.item}` : null,
      title: session ? `${review[subjectId!]?.has(d.item) ? REVIEW_PREFIX : ''}${session.title}` : TITLES[d.kind] ?? d.text,
      keyword: session ? (session.keyword || topicKeyword(session.title)) : '',
      goal: d.kind === 'theory' ? theoryGoal(Math.round(d.hours * 60)) : d.kind === 'simulado' ? b.totalQuestions : d.goal,
    });
  }));
  const summary = {
    ...sched.summary,
    perSubject: b.subjects.map((s) => ({ subjectId: s.id, name: s.name, days: counts[s.id]!.days })),
  };
  return { sessions: sessionRows, tasks, summary, startDate: sched.startDate };
}
