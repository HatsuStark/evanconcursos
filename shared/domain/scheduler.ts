// Scheduler: distribui matérias e conteúdos no calendário de forma determinística (mesma entrada,
// mesmo resultado). Fases: teoria (conteúdo em ordem) → consolidação (questões dos pontos fracos) →
// reta final (simulados e revisão). Datas, horas, revisões e simulados nunca vêm da IA.
import { parseYmd, ymd } from './dates.ts';

export const LEVELS = ['Iniciante', 'Básico', 'Intermediário', 'Avançado'] as const;
export const DEFAULT_HOURS = [2, 2, 2, 2, 2, 3, 2];
// Marca de tarefa de reforço: o assunto é decidido na hora pelo desempenho (assunto mais fraco).
export const WEAK_MARK = '*fracos*';
// Meta de questões da sessão de teoria: amostra do tema, não bateria longa; os dias de consolidação treinam volume.
export const theoryGoal = (minutes: number) => Math.min(10, Math.max(5, Math.round(minutes / 12)));

export interface SubjectInput { name: string; core: boolean }
export interface ScheduleInput { startDate: string; examDate: string; subjects: SubjectInput[] }
export interface SubjectConfig { weight: number; level: number; topics: string[] }
export interface ScheduleConfig { hours: number[]; weeklyReview: boolean; subjects: Record<string, SubjectConfig> }

export type Phase = '' | 'theory' | 'consol' | 'final' | 'review';
// kind: tipo da tarefa; item: na teoria, o índice do tópico/sessão da matéria que o dia cobre (-1 nos demais).
export type DayKind = '' | 'rest' | 'exam' | 'eve' | 'weekly_review' | 'theory' | 'consolidation' | 'final_review' | 'simulado';
export interface ScheduledDay { text: string; hours: number; subject: string; keyword: string; goal: number; kind: DayKind; item: number }
export interface Week { title: string; days: ScheduledDay[] }
export interface ScheduleSummary {
  weeks: number; studyDays: number; theory: number; consol: number; final: number; hours: number;
  perSubject: { name: string; days: number }[];
}
export interface Schedule { weeks: Week[]; startDate: string; config: ScheduleConfig; summary: ScheduleSummary }

// Conteúdo programático colado do edital: separa por linha, ";" ou numeração ("1. ", "2) ", "3 – ").
export function splitTopics(text: string): string[] {
  return String(text || '').split(/\n|;|\s(?=\d+(?:\.\d+)*\s*[.)\-–]\s)/)
    .map((s) => s.replace(/^\s*\d+(?:\.\d+)*\s*[.)\-–]\s*/, '').replace(/^[\s\-–•]+|[\s.]+$/g, ''))
    .filter((s) => s.length > 2).slice(0, 200);
}

// Palavra-chave curta para o filtro de questões: começo do tópico, sem "Noções de" e afins.
export const topicKeyword = (t: string): string =>
  (t.replace(/^(noções|conceitos|aspectos)\s+(gerais\s+)?(de|do|da|dos|das)\s+/i, '').split(/[,:(;]/)[0] ?? '').trim().slice(0, 50);

export function defaultConfig(input: ScheduleInput): ScheduleConfig {
  return {
    hours: [...DEFAULT_HOURS], weeklyReview: true,
    subjects: Object.fromEntries(input.subjects.map((s) => [s.name, { weight: s.core ? 3 : 2, level: 1, topics: [] }])),
  };
}

export function normalizeConfig(raw: unknown, input: ScheduleInput): ScheduleConfig {
  const base = defaultConfig(input);
  const c = (raw && typeof raw === 'object' ? raw : {}) as Partial<{ hours: unknown[]; weeklyReview: boolean; subjects: Record<string, Partial<SubjectConfig>> }>;
  const hours = Array.from({ length: 7 }, (_, i) => {
    const h = Number(c.hours?.[i]);
    return Number.isFinite(h) && h >= 0 && h <= 16 ? h : base.hours[i]!;
  });
  const subjects: Record<string, SubjectConfig> = {};
  for (const { name } of input.subjects) {
    const s = c.subjects?.[name] ?? {}, w = Number(s.weight), l = Number(s.level);
    subjects[name] = {
      weight: Number.isInteger(w) && w >= 1 && w <= 5 ? w : base.subjects[name]!.weight,
      level: Number.isInteger(l) && l >= 0 && l <= 3 ? l : 1,
      topics: (Array.isArray(s.topics) ? s.topics : []).map((t) => String(t).trim().slice(0, 160)).filter(Boolean).slice(0, 200),
    };
  }
  return { hours, weeklyReview: c.weeklyReview !== false, subjects };
}

// Distribui `total` vagas proporcionalmente aos pesos (maiores restos), com mínimo de 1 por item.
export function apportion(weights: number[], total: number): number[] {
  const n = weights.length;
  if (total < n) throw Error('Há menos dias de estudo do que matérias.');
  const sum = weights.reduce((a, b) => a + b, 0), free = total - n, raw = weights.map((w) => (w / sum) * free);
  const out = raw.map((x) => 1 + Math.floor(x));
  let left = total - out.reduce((a, b) => a + b, 0);
  raw.map((x, i): [number, number] => [x - Math.floor(x), i])
    .sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .forEach(([, i]) => { if (left > 0) { out[i]!++; left--; } });
  return out;
}

// Intercala as matérias respeitando as contagens (round-robin ponderado suave): espalha cada matéria
// ao longo do período em vez de concentrá-la em blocos.
export function interleave(counts: number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0), cur = counts.map(() => 0), seq: number[] = [];
  for (let k = 0; k < total; k++) {
    let best = -1;
    counts.forEach((c, i) => { cur[i]! += c; if (best < 0 || cur[i]! > cur[best]!) best = i; });
    cur[best]! -= total;
    seq.push(best);
  }
  return seq;
}

interface TaskText { text: string; keyword: string; item: number }

// Transforma n dias de uma matéria em tarefas a partir dos tópicos (agrupa ou divide em partes).
export function subjectTasks(name: string, topics: string[], n: number): TaskText[] {
  if (!topics.length) return Array.from({ length: n }, (_, j) => ({ text: `${name}: estudo ${j + 1} de ${n}`, keyword: '', item: -1 }));
  if (n >= topics.length) {
    const per = apportion(topics.map(() => 1), n), out: TaskText[] = [];
    topics.forEach((t, i) => {
      for (let p = 0; p < per[i]!; p++) out.push({ text: `${name}: ${t}` + (per[i]! > 1 ? ` (parte ${p + 1} de ${per[i]})` : ''), keyword: topicKeyword(t), item: i });
    });
    return out;
  }
  const sizes = apportion(Array<number>(n).fill(1), topics.length), out: TaskText[] = [];
  let k = 0;
  for (const size of sizes) {
    const chunk = topics.slice(k, k + size);
    k += size;
    out.push({ text: `${name}: ${chunk.join('; ')}`.slice(0, 200), keyword: topicKeyword(chunk[0]!), item: k - size });
  }
  return out;
}

interface Slot extends ScheduledDay { date: Date; week: number; phase: Phase }

export function generateSchedule(input: ScheduleInput, rawConfig: unknown): Schedule {
  const cfg = normalizeConfig(rawConfig, input), start = parseYmd(input.startDate) ?? new Date(), exam = parseYmd(input.examDate);
  if (!exam) throw Error('Informe a data da prova no plano.');
  if (exam <= start) throw Error('A data da prova precisa ser depois do início dos estudos.');
  if (!input.subjects.length) throw Error('O plano não tem matérias.');
  if (!cfg.hours.some((h) => h > 0)) throw Error('Informe horas de estudo em pelo menos um dia da semana.');
  // Calendário de segunda a domingo, da semana do início até a semana da prova.
  const monday = new Date(start);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const slots: Slot[] = [];
  for (const d = new Date(monday); d <= exam || slots.length % 7; d.setDate(d.getDate() + 1)) {
    const wd = (d.getDay() + 6) % 7, inRange = d >= start && d < exam, hours = inRange ? cfg.hours[wd]! : 0;
    slots.push({
      date: new Date(d), week: Math.floor(slots.length / 7), hours, phase: '',
      text: d.getTime() === exam.getTime() ? 'PROVA' : !inRange ? '' : hours ? '' : 'Descanso', subject: '', keyword: '', goal: 0,
      kind: d.getTime() === exam.getTime() ? 'exam' : inRange && !hours ? 'rest' : '', item: -1,
    });
  }
  let study = slots.filter((s) => s.hours > 0);
  if (study.length < input.subjects.length + 1) throw Error('Pouco tempo até a prova para cobrir todas as matérias com essas horas.');
  // Véspera da prova: revisão leve.
  Object.assign(study.pop()!, { text: 'Revisão leve e descanso', phase: 'final', kind: 'eve' });
  // Revisão semanal: último dia de estudo de cada semana com 4 ou mais dias de estudo.
  if (cfg.weeklyReview) {
    const byWeek = new Map<number, Slot[]>();
    for (const s of study) { if (!byWeek.has(s.week)) byWeek.set(s.week, []); byWeek.get(s.week)!.push(s); }
    for (const list of byWeek.values()) if (list.length >= 4) Object.assign(list[list.length - 1]!, { text: 'Revisão da semana e caderno de erros', phase: 'review', kind: 'weekly_review' });
    study = study.filter((s) => !s.text);
  }
  const N = study.length, names = input.subjects.map((s) => s.name);
  if (N < names.length) throw Error('Pouco tempo até a prova para cobrir todas as matérias com essas horas.');
  const finalN = N >= 40 ? Math.round(N * 0.15) : N >= 15 ? Math.round(N * 0.1) : 0;
  const consolN = N >= 30 ? Math.round(N * 0.15) : 0;
  const theoryN = Math.max(names.length, N - finalN - consolN);
  const theory = study.slice(0, theoryN), consol = study.slice(theoryN, theoryN + consolN), final = study.slice(theoryN + consolN);
  // Peso efetivo: importância no edital × reforço para quem tem menos domínio (iniciante pesa 2×, avançado 1×).
  const weights = names.map((n) => { const s = cfg.subjects[n]!; return s.weight * (1 + (3 - s.level) / 3); });
  const counts = apportion(weights, theory.length), queues = names.map((n, i) => subjectTasks(n, cfg.subjects[n]!.topics, counts[i]!));
  interleave(counts).forEach((si, k) => Object.assign(theory[k]!, { ...queues[si]!.shift(), subject: names[si], phase: 'theory', kind: 'theory' }));
  // Consolidação e reta final: questões dos pontos fracos, distribuídas pelo mesmo peso.
  const weakDay = (s: Slot, si: number, label: string, phase: Phase) =>
    Object.assign(s, { text: `${names[si]}: ${label}`, subject: names[si], keyword: WEAK_MARK, goal: Math.round(s.hours * 15), phase, kind: phase === 'consol' ? 'consolidation' : 'final_review' });
  if (consol.length) {
    interleave(apportion(weights, Math.max(consol.length, names.length))).slice(0, consol.length)
      .forEach((si, k) => weakDay(consol[k]!, si, 'questões dos pontos fracos', 'consol'));
  }
  if (final.length) {
    // Um simulado por semana no dia com mais horas: o dia de revisão semanal da semana, se houver
    // (costuma ser o maior), senão o maior dia da reta final. O restante vira revisão por matéria.
    const byWeek = new Map<number, Slot[]>();
    for (const s of final) { if (!byWeek.has(s.week)) byWeek.set(s.week, []); byWeek.get(s.week)!.push(s); }
    const examWeek = slots.find((s) => s.text === 'PROVA')?.week;
    for (const [w, list] of byWeek) {
      if (w === examWeek && byWeek.size > 1) continue; // semana da prova: só revisão, sem simulado
      const review = slots.find((s) => s.week === w && s.phase === 'review');
      const big = review && review.hours >= Math.max(...list.map((s) => s.hours)) ? review : list.reduce((a, b) => (b.hours > a.hours ? b : a));
      Object.assign(big, { text: 'Simulado completo da banca + correção', phase: 'final', kind: 'simulado' });
    }
    const rest = final.filter((s) => !s.text), seq = interleave(apportion(weights, Math.max(rest.length, names.length)));
    rest.forEach((s, k) => weakDay(s, seq[k % seq.length]!, 'revisão final dos pontos fracos', 'final'));
  }
  // Monta as semanas com títulos pela fase predominante e principais matérias.
  const phaseName: Record<string, string> = { theory: 'Teoria', consol: 'Consolidação', final: 'Reta final', review: 'Teoria' };
  const weeks: Week[] = [];
  for (let w = 0; w * 7 < slots.length; w++) {
    const days = slots.slice(w * 7, w * 7 + 7), studied = days.filter((d) => d.phase);
    const tally: Record<string, number> = {};
    for (const d of studied) tally[d.phase] = (tally[d.phase] ?? 0) + 1;
    const main = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0];
    const subs = [...new Set(days.filter((d) => d.subject).map((d) => d.subject))].slice(0, 3);
    const title = days.some((d) => d.text === 'PROVA') && !subs.length ? 'Semana da prova' : `${(main && phaseName[main]) || 'Semana'}${subs.length ? ': ' + subs.join(', ') : ''}`;
    weeks.push({ title, days: days.map((d) => ({ text: d.text, hours: d.hours, subject: d.subject, keyword: d.keyword, goal: d.goal, kind: d.kind, item: d.item })) });
  }
  const summary: ScheduleSummary = {
    weeks: weeks.length, studyDays: N + 1, theory: theory.length, consol: consol.length, final: final.length,
    hours: slots.reduce((a, s) => a + s.hours, 0), perSubject: names.map((n, i) => ({ name: n, days: counts[i]! })),
  };
  return { weeks, startDate: ymd(monday), config: cfg, summary };
}
