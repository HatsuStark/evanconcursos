import { describe, expect, it } from 'vitest';
import { materialSchedule } from './material-schedule.ts';

const range = (id: string, session: string, subject: string, title = session) => ({ id, session_id: session, page_from: 1, page_to: 2, manual: false, title, subject });
const task = (id: string, session: string | null, date: string, done = false) => ({ id, session_id: session, date, kind: 'theory', done_at: done ? '2026-01-01' : null });

describe('apostila no cronograma', () => {
  it('junta os trechos da mesma sessão e traz só as tarefas dela', () => {
    const s = materialSchedule([range('r1', 's1', 'Adm'), range('r2', 's1', 'Adm')], [task('t1', 's1', '2026-11-10'), task('t2', 's9', '2026-11-11'), task('t3', null, '2026-11-12')]);
    expect(s.subjects).toHaveLength(1);
    expect(s.subjects[0]!.sessions[0]!.ranges.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(s.subjects[0]!.sessions[0]!.tasks.map((t) => t.id)).toEqual(['t1']);
    expect(s.totals).toEqual({ sessions: 1, tasks: 1, done: 0 });
  });
  it('ordena pelo que falta estudar e deixa sessão concluída por último', () => {
    const s = materialSchedule(
      [range('r1', 'feita', 'Adm'), range('r2', 'depois', 'Adm'), range('r3', 'antes', 'Penal')],
      [task('t1', 'feita', '2026-11-01', true), task('t2', 'depois', '2026-11-20'), task('t3', 'antes', '2026-11-05')],
    );
    expect(s.subjects.map((g) => g.name)).toEqual(['Penal', 'Adm']);
    expect(s.subjects[1]!.sessions.map((x) => x.sessionId)).toEqual(['depois', 'feita']);
    expect(s.next?.id).toBe('t3');
    expect(s.totals).toEqual({ sessions: 3, tasks: 3, done: 1 });
  });
  it('sessão sem tarefa no cronograma atual fica à parte', () => {
    const s = materialSchedule([range('r1', 'velha', 'Adm'), range('r2', 'atual', 'Adm')], [task('t1', 'atual', '2026-11-05')]);
    expect(s.outside.map((x) => x.sessionId)).toEqual(['velha']);
    expect(s.totals.sessions).toBe(1);
  });
  it('sem nada pendente, não há próxima tarefa', () => {
    expect(materialSchedule([range('r1', 's1', 'Adm')], [task('t1', 's1', '2026-11-05', true)]).next).toBeNull();
  });
});
