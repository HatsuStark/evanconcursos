import { describe, expect, it } from 'vitest';
import { cycleProgress, cycleQueue, type CycleTask } from './cycle.ts';

const task = (date: string, done = false, kind = 'theory'): CycleTask => ({ date, kind, done_at: done ? '2026-10-20T12:00:00Z' : null });

describe('cycleQueue', () => {
  it('mantém a ordem do plano, sem as feitas e sem a prova, qualquer que seja a data', () => {
    const a = task('2026-10-01'), b = task('2026-10-02', true), c = task('2026-12-01', false, 'simulado'), d = task('2026-12-20', false, 'exam');
    expect(cycleQueue([a, b, c, d])).toEqual([a, c]);
  });
});

describe('cycleProgress', () => {
  it('compara o feito com o que as datas previam para hoje', () => {
    const tasks = [task('2026-10-01', true), task('2026-10-02'), task('2026-10-03'), task('2026-10-10'), task('2026-10-20', true), task('2026-12-20', false, 'exam')];
    expect(cycleProgress(tasks, '2026-10-10')).toEqual({ total: 5, done: 2, behind: 2, ahead: 1 });
  });
});
