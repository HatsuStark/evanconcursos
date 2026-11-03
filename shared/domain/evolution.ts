// Evolução do acerto por semana (segunda a domingo), para comparar com o mínimo e a meta do concurso.
import { parseYmd, ymd } from './dates.ts';

export interface WeekPoint { week: string; total: number; correct: number; acc: number | null }

const mondayOf = (day: string) => { const d = parseYmd(day)!; d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };

// As últimas `weeks` semanas até a de hoje; semana sem questão fica com acc null (o gráfico não liga o ponto).
export function weeklyAccuracy(attempts: { created_at: string; correct: boolean }[], today: string, weeks = 12): WeekPoint[] {
  const last = parseYmd(mondayOf(today))!;
  const out: WeekPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(last); d.setDate(d.getDate() - 7 * i);
    out.push({ week: ymd(d), total: 0, correct: 0, acc: null });
  }
  const index = new Map(out.map((p, i) => [p.week, i]));
  for (const a of attempts) {
    const i = index.get(mondayOf(ymd(new Date(a.created_at))));
    if (i === undefined) continue;
    out[i]!.total++;
    if (a.correct) out[i]!.correct++;
  }
  for (const p of out) p.acc = p.total ? p.correct / p.total : null;
  return out;
}

// Começa na primeira semana com questões: semanas vazias antes do início do estudo não dizem nada.
export const fromFirstAnswer = (points: WeekPoint[]) => points.slice(Math.max(0, points.findIndex((p) => p.total > 0)));
