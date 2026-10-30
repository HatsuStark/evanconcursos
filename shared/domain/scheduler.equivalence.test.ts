// Equivalência com o gerador do app legado (tag v0-legado): mesma entrada → mesmo cronograma.
// Vale até a E3, quando o scheduler passa a trabalhar com sessões ligadas a tópicos; aí este teste
// e a pasta legacy-fixture saem.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateSchedule, type ScheduleInput } from './scheduler.ts';

type LegacyApi = {
  normalizePlan: (raw: unknown) => ScheduleInput & { weeks: unknown[] };
  generateWeeks: (plan: unknown, cfg: unknown) => { weeks: unknown; startDate: string; summary: unknown };
  BUILTIN_PLANS: Record<string, ScheduleInput & { weeks: unknown[] }>;
};
const src = ['plans.js', 'generator.js'].map((f) => readFileSync(new URL(`./legacy-fixture/${f}`, import.meta.url), 'utf8')).join('\n');
const legacy = new Function(`${src};return {normalizePlan,generateWeeks,BUILTIN_PLANS}`)() as LegacyApi;

// Gerador pseudoaleatório com semente fixa: os cenários são sempre os mesmos.
function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
}
const pad = (n: number) => String(n).padStart(2, '0');

function scenario(seed: number) {
  const r = rng(seed), int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  const start = new Date(2026, int(0, 11), int(1, 28)), exam = new Date(start);
  exam.setDate(exam.getDate() + (r() < 0.1 ? int(-2, 10) : int(20, 400))); // ~10%: prova antes/muito perto (erros)
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const subjects = Array.from({ length: int(1, 9) }, (_, i) => ({ name: `Matéria ${i + 1}`, core: r() < 0.5 }));
  const cfg = {
    hours: Array.from({ length: 7 }, () => (r() < 0.2 ? 0 : int(1, 8) / 2)),
    weeklyReview: r() < 0.7,
    subjects: Object.fromEntries(subjects.map((s) => [s.name, {
      weight: int(1, 5), level: int(0, 3),
      topics: Array.from({ length: int(0, 30) }, (_, k) => `Tópico ${k + 1} de ${s.name}, detalhes (art. ${k})`),
    }])),
  };
  return { plan: { id: 'p', name: 'P', startDate: ymd(start), examDate: ymd(exam), subjects }, cfg };
}

// Compara só os campos que o gerador legado produzia (kind e item são novos).
type AnyWeek = { title: string; days: { text: string; hours: number; subject: string; keyword: string; goal: number }[] };
const pick = (s: { weeks: unknown; startDate: string; summary: unknown }) => ({
  weeks: (s.weeks as AnyWeek[]).map((w) => ({ title: w.title, days: w.days.map(({ text, hours, subject, keyword, goal }) => ({ text, hours, subject, keyword, goal })) })),
  startDate: s.startDate, summary: s.summary,
});
const run = <T,>(f: () => T): T | { error: string } => { try { return f(); } catch (e) { return { error: (e as Error).message }; } };

describe('scheduler ≡ gerador legado', () => {
  it('plano TJSP embutido, configuração padrão', () => {
    const tj = legacy.BUILTIN_PLANS['tjsp-oj-2027']!;
    expect(pick(generateSchedule(tj, null))).toEqual(pick(legacy.generateWeeks(tj, null)));
  });

  it('200 cenários aleatórios (inclusive os que dão erro)', () => {
    let compared = 0, errors = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { plan, cfg } = scenario(seed);
      const lp = legacy.normalizePlan(plan);
      const expected = run(() => pick(legacy.generateWeeks(lp, cfg)));
      const actual = run(() => pick(generateSchedule(lp, cfg)));
      expect(actual, `semente ${seed}`).toEqual(expected);
      if ('error' in expected) errors++; else compared++;
    }
    expect(compared).toBeGreaterThan(150);
    expect(errors).toBeGreaterThan(0);
  });
});
