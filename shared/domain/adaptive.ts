// Foco adaptativo e revisão espaçada, a partir dos registros de questões (acertos/total por assunto).
import { DAY_MS, startOfDay } from './dates.ts';

export interface QuestionRecord { subject: string; topic: string; correct: number; total: number; ts: number }

// Acerto suavizado: começa em 70% (peso de 10 questões) e os resultados decaem com meia-vida de 30 dias.
// Matérias específicas pesam 20% a mais na prioridade.
export const PRIOR = 0.7, PRIOR_WEIGHT = 10, HALF_LIFE_DAYS = 30, CORE_BOOST = 1.2;

export interface FocusEntry { subject: string; topic?: string; c: number; t: number; cw: number; tw: number; priority: number }

export function analyze(records: QuestionRecord[], subjects: { name: string; core: boolean }[], now = Date.now()) {
  const core = new Set(subjects.filter((s) => s.core).map((s) => s.name));
  type Acc = Omit<FocusEntry, 'priority'>;
  const bySubject: Record<string, Acc> = {}, byTopic: Record<string, Acc> = {};
  const add = (map: Record<string, Acc>, key: string, r: QuestionRecord, w: number, topic?: string) => {
    const e = (map[key] ??= { subject: r.subject, ...(topic ? { topic } : {}), c: 0, t: 0, cw: 0, tw: 0 });
    e.c += r.correct; e.t += r.total; e.cw += r.correct * w; e.tw += r.total * w;
  };
  for (const r of records) {
    const w = r.ts ? Math.pow(0.5, Math.max(0, now - r.ts) / DAY_MS / HALF_LIFE_DAYS) : 0.5;
    add(bySubject, r.subject, r, w);
    if (r.topic) add(byTopic, r.subject + '|' + r.topic.toLowerCase(), r, w, r.topic);
  }
  const priority = (e: Acc) => (1 - (e.cw + PRIOR * PRIOR_WEIGHT) / (e.tw + PRIOR_WEIGHT)) * (core.has(e.subject) ? CORE_BOOST : 1);
  const rows: FocusEntry[] = subjects
    .map(({ name }) => { const e = bySubject[name] ?? { subject: name, c: 0, t: 0, cw: 0, tw: 0 }; return { ...e, priority: priority(e) }; })
    .sort((x, y) => y.priority - x.priority);
  const weakTopics: FocusEntry[] = Object.values(byTopic).filter((e) => e.t >= 5)
    .map((e) => ({ ...e, priority: priority(e) })).sort((x, y) => y.priority - x.priority);
  return { rows, weakTopics };
}

// Mínimo e meta de acerto do concurso: o mínimo é a última nota de corte do cargo (% da prova objetiva) e a meta fica
// 10 pontos acima, até 95%. Sem nota de corte, mínimo de 80% e meta de 90%. Abaixo do mínimo, o tema entra no reforço.
export interface ScoreGoal { min: number; target: number; fromCutoff: boolean }
export const DEFAULT_GOAL: ScoreGoal = { min: 0.8, target: 0.9, fromCutoff: false };
export function scoreGoal(cutoffPct: number | null | undefined): ScoreGoal {
  const cut = Number(cutoffPct);
  if (!cutoffPct || !Number.isFinite(cut) || cut <= 0 || cut > 100) return DEFAULT_GOAL;
  const min = cut / 100;
  return { min, target: Math.max(min, Math.min(0.95, min + 0.1)), fromCutoff: true };
}
export const goalLabel = (g: ScoreGoal) => `${g.fromCutoff ? 'nota de corte' : 'mínimo'} ${Math.round(g.min * 100)}% · meta ${Math.round(g.target * 100)}%`;
// Cor do acerto: meta (verde), mínimo (ciano), abaixo (laranja).
export const goalTone = (acc: number, g: ScoreGoal) => (acc >= g.target ? 'lime' : acc >= g.min ? 'cyan' : 'orange');

export type Verdict = { text: string; level: '' | 'ok' | 'warning' | 'bad' };
export function evaluate(acc: number | null, g: ScoreGoal = DEFAULT_GOAL): Verdict {
  if (acc == null) return { text: 'Sem questões registradas', level: '' };
  if (acc >= g.target) return { text: 'Ótimo: na meta', level: 'ok' };
  if (acc >= g.min) return { text: `Bom: acima ${g.fromCutoff ? 'da nota de corte' : 'do mínimo'}, falta chegar à meta`, level: 'ok' };
  return acc >= g.min - 0.15 ? { text: 'Atenção: abaixo do mínimo, entrou no reforço', level: 'warning' } : { text: 'Reforçar: entrou no reforço', level: 'bad' };
}

// Nota do tema: as questões ainda não respondidas ficam pendentes e contam na conta, para o tema não parecer completo.
export function questionScore(correct: number, answered: number, planned: number) {
  const total = Math.max(planned, answered);
  return { total, pending: total - answered, pct: total ? Math.round((correct / total) * 100) : 0 };
}

// Questão refeita conta uma vez, pela resposta mais recente.
export function latestAnswers<T extends { qid: string; created_at: string }>(attempts: T[]): T[] {
  const byQuestion = new Map<string, T>();
  for (const a of attempts) {
    const seen = byQuestion.get(a.qid);
    if (!seen || a.created_at > seen.created_at) byQuestion.set(a.qid, a);
  }
  return [...byQuestion.values()];
}

// Acerto baixo → questões médias; acerto alto → questões mais difíceis (escala 1–5 do QConcursos).
export const difficultyFor = (acc: number): string[] => (acc < 0.6 ? ['2', '3'] : acc < 0.8 ? ['3', '4'] : ['4', '5']);

// Revisão espaçada: tema fraco volta em 1, 3 e 7 dias; cada dia de revisão no mínimo do concurso avança uma etapa,
// abaixo disso recomeça. Depois da 3ª revisão boa o tema sai da fila. Tudo é derivado dos registros.
export const REVIEW_DAYS = [1, 3, 7];
export interface ThemedRecord extends QuestionRecord { theme: string }
export interface ReviewItem { theme: string; stage: number; last: { d: number; c: number; t: number }; due: number; sample: ThemedRecord }

export function reviewQueue(records: ThemedRecord[], g: ScoreGoal = DEFAULT_GOAL): ReviewItem[] {
  const groups = new Map<string, ThemedRecord[]>();
  for (const r of records) if (r.theme) { if (!groups.has(r.theme)) groups.set(r.theme, []); groups.get(r.theme)!.push(r); }
  const out: ReviewItem[] = [];
  for (const [theme, list] of groups) {
    const days = new Map<number, { d: number; c: number; t: number }>();
    for (const r of list) {
      const d = startOfDay(r.ts), e = days.get(d) ?? { d, c: 0, t: 0 };
      e.c += r.correct; e.t += r.total; days.set(d, e);
    }
    const sessions = [...days.values()].sort((x, y) => x.d - y.d);
    let stage = 0, weak = false;
    for (const s of sessions) { if (s.c / s.t < g.min) { weak = true; stage = 0; } else if (weak) stage++; }
    if (!weak || stage >= REVIEW_DAYS.length) continue;
    const last = sessions[sessions.length - 1]!;
    out.push({ theme, stage, last, due: last.d + REVIEW_DAYS[stage]! * DAY_MS, sample: list[list.length - 1]! });
  }
  return out.sort((x, y) => x.due - y.due);
}
