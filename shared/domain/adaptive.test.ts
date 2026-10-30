import { describe, expect, it } from 'vitest';
import { analyze, difficultyFor, evaluate, reviewQueue, type ThemedRecord } from './adaptive.ts';
import { DAY_MS } from './dates.ts';

const NOW = new Date(2027, 0, 20, 12).getTime();
const rec = (subject: string, topic: string, correct: number, total: number, daysAgo: number, theme = ''): ThemedRecord =>
  ({ subject, topic, correct, total, ts: NOW - daysAgo * DAY_MS, theme });

describe('analyze', () => {
  const subjects = [{ name: 'Penal', core: true }, { name: 'Português', core: false }, { name: 'Informática', core: false }];
  it('ordena pela pior performance; sem dados fica no prior; específica pesa mais', () => {
    const { rows } = analyze([rec('Português', 'crase', 4, 10, 1), rec('Penal', 'dolo', 9, 10, 1)], subjects, NOW);
    expect(rows.map((r) => r.subject)).toEqual(['Português', 'Informática', 'Penal']);
    const empty = analyze([], subjects, NOW).rows;
    expect(empty[0]!.subject).toBe('Penal'); // mesmo prior, ×1.2 por ser específica
  });
  it('resultado antigo pesa menos (meia-vida de 30 dias)', () => {
    const old = analyze([rec('Português', 'crase', 0, 20, 120)], subjects, NOW).rows.find((r) => r.subject === 'Português')!;
    const fresh = analyze([rec('Português', 'crase', 0, 20, 0)], subjects, NOW).rows.find((r) => r.subject === 'Português')!;
    expect(fresh.priority).toBeGreaterThan(old.priority);
  });
  it('weakTopics só com 5+ questões', () => {
    const { weakTopics } = analyze([rec('Penal', 'Dolo', 1, 4, 1), rec('Penal', 'Culpa', 1, 6, 1)], subjects, NOW);
    expect(weakTopics.map((t) => t.topic)).toEqual(['Culpa']);
  });
});

describe('evaluate e difficultyFor', () => {
  it('faixas', () => {
    expect(evaluate(null).level).toBe('');
    expect(evaluate(0.9).level).toBe('ok');
    expect(evaluate(0.7).level).toBe('warning');
    expect(evaluate(0.5).level).toBe('bad');
    expect(difficultyFor(0.5)).toEqual(['2', '3']);
    expect(difficultyFor(0.7)).toEqual(['3', '4']);
    expect(difficultyFor(0.9)).toEqual(['4', '5']);
  });
});

describe('reviewQueue (1, 3 e 7 dias)', () => {
  it('tema fraco entra; revisões boas avançam; após 3 sai', () => {
    const weak = rec('Penal', 'dolo', 5, 10, 5, 't1');
    expect(reviewQueue([weak])[0]).toMatchObject({ theme: 't1', stage: 0 });
    const one = [weak, rec('Penal', 'dolo', 9, 10, 4, 't1')];
    expect(reviewQueue(one)[0]!.stage).toBe(1);
    const done = [...one, rec('Penal', 'dolo', 9, 10, 2, 't1'), rec('Penal', 'dolo', 9, 10, 0, 't1')];
    expect(reviewQueue(done)).toHaveLength(0);
  });
  it('revisão ruim recomeça; tema bom nunca entra; ordena pelo vencimento', () => {
    const reset = [rec('Penal', 'dolo', 5, 10, 5, 'a'), rec('Penal', 'dolo', 9, 10, 4, 'a'), rec('Penal', 'dolo', 2, 10, 3, 'a')];
    expect(reviewQueue(reset)[0]!.stage).toBe(0);
    expect(reviewQueue([rec('Penal', 'x', 9, 10, 1, 'b')])).toHaveLength(0);
    const q = reviewQueue([rec('P', 'x', 1, 10, 1, 'late'), rec('P', 'y', 1, 10, 6, 'early')]);
    expect(q.map((i) => i.theme)).toEqual(['early', 'late']);
  });
});
