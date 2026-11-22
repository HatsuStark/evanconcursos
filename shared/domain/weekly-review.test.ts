import { describe, expect, it } from 'vitest';
import { buildWeeklyQueue, pickExtra, schemeDeck, themeScore } from './weekly-review.ts';

const T = '2026-11-22';
const theme = (id: string, due_on = T, last_result: string | null = null) => ({ id, session_id: `s-${id}`, due_on, last_result });
const err = (qid: string, theme?: string) => ({ qid, session_id: theme ? `s-${theme}` : null });

describe('themeScore', () => {
  it('soma atraso, último resultado e erros (até 5)', () => {
    expect(themeScore(theme('a', '2026-11-19', 'esqueci'), 9, T)).toBe(3 + 7 + 10);
    expect(themeScore(theme('b', '2026-11-25', 'parcial'), 0, T)).toBe(3);
  });
});

describe('buildWeeklyQueue', () => {
  it('ordena pela prioridade e leva os erros de cada tema com ele', () => {
    const a = theme('a', T), b = theme('b', '2026-11-15'), c = theme('c', T, 'esqueci');
    const q = buildWeeklyQueue([a, b, c], [err('q1', 'a'), err('q2'), err('q3', 'c')], 60, T);
    expect(q.steps.map((s) => s.theme.id)).toEqual(['c', 'b', 'a']);
    expect(q.steps.map((s) => s.errors)).toEqual([['q3'], [], ['q1']]);
    expect(q.loose).toEqual(['q2']);
    expect([q.deferredThemes, q.deferredErrors, q.minutes]).toEqual([0, 0, 17]);
  });
  it('corta pelo tempo: o que não cabe fica para a próxima semana', () => {
    const themes = Array.from({ length: 10 }, (_, i) => theme(`t${i}`, `2026-11-1${i}`));
    const errors = Array.from({ length: 10 }, (_, i) => err(`e${i}`));
    const q = buildWeeklyQueue(themes, errors, 30, T);
    expect(q.steps).toHaveLength(7);
    expect(q.steps[0]!.theme.id).toBe('t0');
    expect(q.loose).toEqual(['e0']);
    expect([q.deferredThemes, q.deferredErrors]).toEqual([3, 9]);
    expect(q.minutes).toBeLessThanOrEqual(30);
  });
  it('sempre entra pelo menos um tema, mesmo maior que o tempo; até 5 erros por tema, o resto fecha a sessão', () => {
    const errors = Array.from({ length: 8 }, (_, i) => err(`e${i}`, 'a'));
    const q = buildWeeklyQueue([theme('a')], errors, 10, T);
    expect(q.steps[0]!.errors).toEqual(['e0', 'e1', 'e2', 'e3', 'e4']);
    expect(q.loose).toEqual(['e5', 'e6', 'e7']);
  });
  it('tema que ficou para depois solta os erros dele para o fechamento', () => {
    const themes = [...Array.from({ length: 7 }, (_, i) => theme(`t${i}`, `2026-11-1${i}`)), theme('t7', T)];
    const q = buildWeeklyQueue(themes, [err('x', 't7')], 30, T);
    expect(q.steps.some((s) => s.theme.id === 't7')).toBe(false);
    expect(q.loose).toEqual(['x']);
  });
});

describe('schemeDeck', () => {
  const br = (topico: string, ...itens: string[]) => ({ topico, itens });
  it('precisa de 3 ramos e 4 itens', () => {
    expect(schemeDeck([br('A', 'a1', 'a2'), br('B', 'b1')])).toEqual([]);
    expect(schemeDeck([br('A', 'a1'), br('B', 'b1'), br('C', 'c1')])).toEqual([]);
    expect(schemeDeck(undefined)).toEqual([]);
  });
  it('até 8 itens, de todos os ramos, com o ramo certo', () => {
    const d = schemeDeck([br('A', 'a1', 'a2', 'a3', 'a4'), br('B', 'b1', 'b2', 'b3'), br('C', 'c1', 'c2', 'c3'), br(' ', 'x')]);
    expect(d).toHaveLength(8);
    expect(new Set(d.map((c) => c.branch))).toEqual(new Set([0, 1, 2]));
    expect(d.find((c) => c.item === 'b2')?.branch).toBe(1);
    expect(schemeDeck([br('A', 'a1', 'a2', 'a3', 'a4'), br('B', 'b1', 'b2', 'b3'), br('C', 'c1', 'c2', 'c3')])).toEqual(d);
  });
});

describe('pickExtra', () => {
  it('3ª revisão: esquema; outras: certo ou errado; sem a escolhida, a outra', () => {
    expect(pickExtra(3, { tf: true, scheme: true })).toBe('scheme');
    expect(pickExtra(2, { tf: true, scheme: true })).toBe('tf');
    expect(pickExtra(1, { tf: false, scheme: true })).toBe('scheme');
    expect(pickExtra(3, { tf: true, scheme: false })).toBe('tf');
    expect(pickExtra(2, { tf: false, scheme: false })).toBeNull();
  });
});
