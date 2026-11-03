import { describe, expect, it } from 'vitest';
import { fromFirstAnswer, weeklyAccuracy } from './evolution.ts';

const at = (day: string, correct: boolean) => ({ created_at: `${day}T12:00:00`, correct });

describe('weeklyAccuracy', () => {
  it('agrupa de segunda a domingo e termina na semana de hoje', () => {
    const r = weeklyAccuracy([at('2026-11-02', true), at('2026-11-08', false), at('2026-11-09', true)], '2026-11-10', 3);
    expect(r.map((p) => p.week)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09']);
    expect(r.map((p) => [p.total, p.acc])).toEqual([[0, null], [2, 0.5], [1, 1]]);
  });
  it('ignora o que é anterior à janela', () => {
    expect(weeklyAccuracy([at('2026-01-05', true)], '2026-11-10', 4).every((p) => p.total === 0)).toBe(true);
  });
  it('corta as semanas vazias antes da primeira questão', () => {
    const r = fromFirstAnswer(weeklyAccuracy([at('2026-11-09', true)], '2026-11-10', 4));
    expect(r.map((p) => p.week)).toEqual(['2026-11-09']);
  });
});
