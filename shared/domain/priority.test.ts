import { describe, expect, it } from 'vitest';
import { coverage, prioritizeTasks } from './coverage.ts';
import { prioritize, priorityOrder } from './priority.ts';
import type { ReplanTask } from './replan.ts';

describe('prioridade pela cobrança', () => {
  const s = (title: string, incidence?: number) => ({ title, incidence });
  it('mais cobrados primeiro; empate na ordem do edital', () => {
    expect(prioritize([s('A', 1), s('B', 3), s('C', 2), s('D', 3)]).map((x) => x.title)).toEqual(['B', 'D', 'C', 'A']);
    expect(prioritize([s('A'), s('B'), s('C')]).map((x) => x.title)).toEqual(['A', 'B', 'C']);
  });
  it('partes andam juntas, na ordem, pela maior cobrança', () => {
    const list = [s('A', 2), s('T (parte 1 de 2): x', 1), s('T (parte 2 de 2): y', 3), s('B', 2)];
    expect(prioritize(list).map((x) => x.title)).toEqual(['T (parte 1 de 2): x', 'T (parte 2 de 2): y', 'A', 'B']);
  });
  it('aprofundamento fica no lugar, nunca entre partes; com deepLast vai para o fim', () => {
    const list = [s('A', 1), s('T (parte 1 de 2)', 3), s('Aprofundamento: A'), s('T (parte 2 de 2)', 3), s('B', 2)];
    expect(prioritize(list).map((x) => x.title)).toEqual(['T (parte 1 de 2)', 'T (parte 2 de 2)', 'Aprofundamento: A', 'B', 'A']);
    expect(priorityOrder(list, { deepLast: true }).at(-1)).toBe(2);
  });
});

describe('cobertura antes da reta final', () => {
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const base = new Date(2027, 0, 1, 12), day = (n: number) => ymd(new Date(base.getTime() + n * 86_400_000));
  const today = day(30), now = new Date(base.getTime() + 30 * 86_400_000).getTime();
  let id = 0;
  const task = (d: number, kind: string, extra: Partial<ReplanTask> = {}): ReplanTask => ({
    id: `t${++id}`, date: day(d), minutes: 60, kind, subject_id: 's1', session_id: kind === 'theory' || kind === 'lei_seca' ? `x${id}` : null,
    title: `Tema ${id}`, keyword: '', goal_questions: 10, done_at: null, ...extra,
  });
  // 30 dias feitos (1 sessão por dia), 40 pela frente antes da reta final (dia 70).
  const plan = (doneEvery: number) => {
    id = 0;
    const past = Array.from({ length: 30 }, (_, d) => task(d, 'theory', { done_at: d % doneEvery === 0 ? new Date(base.getTime() + d * 86_400_000).toISOString() : null, date: day(d) }));
    // Os que não foram feitos já foram reorganizados para frente: ficam fora do passado.
    const ahead = Array.from({ length: 40 }, (_, d) => task(30 + d, 'theory'));
    return [...past.filter((t) => t.done_at), ...ahead, task(70, 'final_review'), task(71, 'pente_fino')];
  };
  it('no ritmo do plano, nada a avisar', () => {
    expect(coverage(plan(1), new Map(), today, now)).toBeNull();
  });
  it('no ritmo de metade, avisa quantas ficariam para depois', () => {
    const c = coverage(plan(2), new Map(), today, now)!;
    expect(c.pace).toBeCloseTo(0.5, 1);
    expect(c.missing).toBeGreaterThanOrEqual(15);
    expect(c.atRisk.length).toBe(3);
  });
  it('longe da reta final, não avisa', () => {
    expect(coverage(plan(2), new Map(), day(5), new Date(base.getTime() + 5 * 86_400_000).getTime())).toBeNull();
  });
  it('priorizar: mesmos dias da matéria, mais cobrados primeiro, lei seca acompanha', () => {
    id = 0;
    const a = task(31, 'theory'), b = task(32, 'theory'), c = task(33, 'theory');
    const lei = { ...task(34, 'lei_seca'), session_id: a.session_id };
    const r = prioritizeTasks([a, b, c, lei], new Map([[a.session_id!, 1], [b.session_id!, 2], [c.session_id!, 3]]), day(30));
    expect(r.order.map((t) => t.id)).toEqual([c.id, b.id, a.id]);
    const first = r.tasks.find((t) => t.kind === 'theory' && t.date === day(31))!;
    expect(first.sessionId).toBe(c.session_id);
    expect(first.fromTaskId).toBe(c.id);
    expect(r.tasks.find((t) => t.kind === 'lei_seca')).toMatchObject({ date: day(34), sessionId: c.session_id, title: `Lei seca: ${c.title}` });
    expect(r.supersede).not.toContain(b.id); // b continua no mesmo dia
  });
});
