// Montagem do cronograma: une as sessões (IA, já corrigidas) ao calendário determinístico do scheduler
// e produz o payload de create_plan_version. Duas passadas: a 1ª dá quantos blocos de teoria cada matéria
// recebe (n de sessões pedido à IA); a 2ª encaixa as sessões, uma por bloco, na ordem, e a lei seca nas que citam lei.
import { findLawRefs, type LawRef } from '../legal/refs.ts';
import { parseYmd, ymd } from '../domain/dates.ts';
import { generateSchedule, topicKeyword, type BlockKind, type ScheduleConfig, type ScheduleInput } from '../domain/scheduler.ts';
import type { PlanInputs, Session } from './plan.ts';

export const GENERATOR_VERSION = 'scheduler-v2';
export const REVIEW_PREFIX = 'Revisão: ';

// questions: questões na prova; weight: peso no edital; minPct: nota mínima do bloco da prova (eliminatória).
// block: bloco da prova; blocks: questões de cada bloco (para dividir entre as matérias sem número no edital).
export interface PlanSubject { id: string; name: string; core: boolean; questions: number; weight: number; minPct?: number; block?: string; topics: { id: string; text: string }[] }
// minBlocks: sessões que o conteúdo de cada matéria pede (plano sem prazo, depois de medir as leis); vira o mínimo de blocos.
export interface PlanBase {
  examDate: string; openEnded?: boolean; totalQuestions: number; subjects: PlanSubject[]; inputs: PlanInputs; weights: Record<string, number>;
  blocks?: { name: string; questions: number }[]; minBlocks?: Record<string, number>;
}

export type TaskKind = BlockKind | 'weekly_review' | 'simulado' | 'eve' | 'exam';
// lawRefs: lei e artigos da sessão, decididos na montagem (null: a lei seca, a apostila e as questões leem o título).
export interface SessionRow { key: string; subjectId: string; position: number; title: string; keyword: string; topicIds: string[]; incidence: number; lawRefs: LawRef[] | null }
export interface TaskRow { date: string; position: number; minutes: number; kind: TaskKind; subjectId: string | null; sessionKey: string | null; title: string; keyword: string; goal: number }

const TITLES: Partial<Record<TaskKind, string>> = {
  consolidation: 'Questões dos pontos fracos', final_review: 'Revisão final dos pontos fracos',
  pente_fino: 'Pente-fino: para memorizar, pegadinhas e marcações',
  weekly_review: 'Revisão da semana e caderno de erros', simulado: 'Simulado completo + correção',
  eve: 'Revisão leve e descanso', exam: 'Dia da prova',
};

// Lei seca diária quando pelo menos um quarto das matérias cita lei no edital (concurso de legislação).
export function needsLawReading(b: PlanBase) {
  const withLaw = b.subjects.filter((s) => s.topics.some((t) => findLawRefs(t.text, s.name).length) || findLawRefs(s.name).length).length;
  return withLaw >= Math.max(1, Math.ceil(b.subjects.length / 4));
}

// Matéria sem número de questões no edital (comum quando a prova dá questões por bloco): a parte que falta do bloco dela,
// dividida entre as matérias sem número do bloco; sem bloco, a parte que falta do total da prova.
export function questionsOf(b: PlanBase) {
  const share = (list: PlanSubject[], total: number) => {
    const missing = list.filter((s) => !s.questions).length, left = total - list.reduce((a, s) => a + s.questions, 0);
    return missing && left > 0 ? Math.max(1, Math.round(left / missing)) : 0;
  };
  const byBlock = new Map((b.blocks ?? []).filter((x) => x.questions > 0).map((x) => [x.name.trim().toLowerCase(), x.questions]));
  const overall = share(b.subjects, b.totalQuestions);
  return Object.fromEntries(b.subjects.map((s) => {
    if (s.questions) return [s.id, s.questions];
    const total = byBlock.get((s.block ?? '').trim().toLowerCase());
    const fill = total ? share(b.subjects.filter((x) => (x.block ?? '').trim().toLowerCase() === (s.block ?? '').trim().toLowerCase()), total) : 0;
    return [s.id, fill || overall];
  }));
}

// No scheduler, as matérias são identificadas pelo id (nomes podem se repetir).
function scheduleArgs(b: PlanBase, sessions?: Record<string, Session[]>): [ScheduleInput, ScheduleConfig] {
  const questions = questionsOf(b);
  return [
    { startDate: b.inputs.startDate, examDate: b.examDate, openEnded: b.openEnded, subjects: b.subjects.map((s) => ({ name: s.id, core: s.core })) },
    {
      hours: b.inputs.hours, weeklyReview: b.inputs.weeklyReview, lawReading: needsLawReading(b),
      subjects: Object.fromEntries(b.subjects.map((s) => {
        const list = sessions?.[s.id] ?? [];
        return [s.id, {
          weight: b.weights[s.id] ?? s.weight, level: b.inputs.levels[s.id] ?? 1, topics: list.map((x) => x.title),
          topicCount: s.topics.length, questions: questions[s.id], stake: s.weight, minPct: s.minPct, minBlocks: b.minBlocks?.[s.id],
          lawItems: list.map((x) => !!x.refs?.length || findLawRefs(x.title, s.name).some((r) => r.ranges.length)), incidence: list.map((x) => x.incidence ?? 2),
        }];
      })),
    },
  ];
}

// 1ª passada: blocos de teoria por matéria e minutos médios por bloco (para o prompt das sessões).
export function theoryPlan(b: PlanBase) { return firstPass(b).counts; }
// Semanas e horas totais do calendário (contexto para a estratégia da IA).
export function calendarSummary(b: PlanBase) { return firstPass(b).summary; }

function firstPass(b: PlanBase) {
  const sched = generateSchedule(...scheduleArgs(b));
  const minutes: Record<string, number[]> = {};
  for (const block of sched.weeks.flatMap((w) => w.days.flatMap((d) => d.blocks))) if (block.kind === 'theory') (minutes[block.subject] ??= []).push(block.minutes);
  const counts = Object.fromEntries(b.subjects.map((s) => {
    const m = minutes[s.id] ?? [];
    return [s.id, { days: m.length, avgMinutes: m.length ? Math.round(m.reduce((a, x) => a + x, 0) / m.length) : 75 }];
  })) as Record<string, { days: number; avgMinutes: number }>;
  return { counts, summary: sched.summary };
}

// Plano sem prazo: as sessões vieram do tamanho do conteúdo (lei longa em partes), e não do calendário. Cada matéria passa
// a ter pelo menos as suas, e o fim da primeira volta anda semana a semana até caber. Devolve os blocos de cada matéria
// (podem passar das sessões: o que sobra vira aprofundamento).
export const MAX_OPEN_WEEKS = 260;
export function fitOpenEnded(b: PlanBase, need: Record<string, number>) {
  b.minBlocks = need;
  const start = parseYmd(b.inputs.startDate) ?? new Date();
  for (let i = 0; i < 40; i++) {
    const { counts, summary } = firstPass(b);
    const deficit = b.subjects.reduce((a, s) => a + Math.max(0, (need[s.id] ?? 0) - counts[s.id]!.days), 0);
    if (!deficit) return counts;
    const end = parseYmd(b.examDate)!, perWeek = Math.max(1, summary.theory / Math.max(1, summary.weeks));
    if ((end.getTime() - start.getTime()) / (7 * 86_400_000) >= MAX_OPEN_WEEKS) return counts;
    end.setDate(end.getDate() + 7 * Math.max(1, Math.ceil(deficit / perWeek)));
    b.examDate = ymd(end);
  }
  return firstPass(b).counts;
}

// Novo edital: em cada matéria, o conteúdo novo vem antes, e vira revisão a sessão cujos tópicos já foram todos estudados.
// `topicIds` são os tópicos do edital novo, na ordem em que as sessões os numeram.
export function carryOverSessions(list: Session[], topicIds: string[], studied: Set<string>) {
  const isKnown = (s: Session) => !!s.topics.length && s.topics.every((t) => { const id = topicIds[t]; return !!id && studied.has(id); });
  const ordered = [...list.filter((s) => !isKnown(s)), ...list.filter(isKnown)];
  return { sessions: ordered, review: new Set(ordered.flatMap((s, i) => (isKnown(s) ? [i] : []))) };
}

// 2ª passada: cronograma final com sessões. `sessions[subjectId]` precisa ter exatamente os blocos da 1ª passada.
// `review`: sessões já estudadas, por matéria e posição, cuja tarefa é de revisão.
export function buildPlanPayload(b: PlanBase, sessions: Record<string, Session[]>, review: Record<string, Set<number>> = {}) {
  const counts = theoryPlan(b);
  for (const s of b.subjects) {
    if ((sessions[s.id]?.length ?? 0) !== counts[s.id]!.days) throw Error(`${s.name}: esperadas ${counts[s.id]!.days} sessões, vieram ${sessions[s.id]?.length ?? 0}.`);
  }
  const sched = generateSchedule(...scheduleArgs(b, sessions));
  const sessionRows: SessionRow[] = b.subjects.flatMap((s) => sessions[s.id]!.map((x, i) => ({
    key: `${s.id}:${i}`, subjectId: s.id, position: i, title: x.title, keyword: x.keyword || topicKeyword(x.title), incidence: x.incidence ?? 2,
    topicIds: x.topics.map((t) => s.topics[t]?.id).filter((id): id is string => !!id),
    lawRefs: x.refs?.length ? x.refs : null,
  })));
  const monday = parseYmd(sched.startDate)!;
  const tasks: TaskRow[] = [];
  sched.weeks.forEach((w, wi) => w.days.forEach((d, di) => {
    if (d.kind === '' || d.kind === 'rest') return;
    const date = new Date(monday); date.setDate(monday.getDate() + wi * 7 + di);
    if (d.kind !== 'study') {
      tasks.push({ date: ymd(date), position: 0, minutes: Math.round(d.hours * 60), kind: d.kind, subjectId: null, sessionKey: null,
        title: TITLES[d.kind] ?? d.text, keyword: '', goal: d.kind === 'simulado' ? b.totalQuestions : 0 });
      return;
    }
    d.blocks.forEach((block, position) => {
      const session = (block.kind === 'theory' || block.kind === 'lei_seca') && block.item >= 0 ? sessions[block.subject]![block.item] : undefined;
      const key = session ? `${block.subject}:${block.item}` : null;
      const title = !session ? TITLES[block.kind] ?? block.text
        : block.kind === 'lei_seca' ? `Lei seca: ${session.title}`
        : `${review[block.subject]?.has(block.item) ? REVIEW_PREFIX : ''}${session.title}`;
      tasks.push({
        date: ymd(date), position, minutes: block.minutes, kind: block.kind, subjectId: block.subject || null, sessionKey: key, title,
        keyword: session ? (session.keyword || topicKeyword(session.title)) : block.keyword,
        goal: block.goal,
      });
    });
  }));
  const summary = {
    ...sched.summary,
    perSubject: b.subjects.map((s) => ({ subjectId: s.id, name: s.name, days: counts[s.id]!.days })),
  };
  return { sessions: sessionRows, tasks, summary, startDate: sched.startDate };
}
