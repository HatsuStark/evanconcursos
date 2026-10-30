import { describe, expect, it } from 'vitest';
import { overdueTasks, replan, subjectWeakness, type ReplanAttempt, type ReplanTask } from './replan.ts';

const TODAY = '2030-03-10', NOW = new Date('2030-03-10T12:00:00Z').getTime();
let seq = 0;
const task = (date: string, kind: string, subject_id: string | null = 'a', extra: Partial<ReplanTask> = {}): ReplanTask => {
  const id = `t${++seq}`;
  return { id, date, minutes: 120, kind, subject_id, session_id: kind === 'theory' ? `s-${id}` : null, title: `${kind} ${id}`, keyword: '', goal_questions: 20, done_at: null, ...extra };
};
const subjects = [{ id: 'a', weight: 3 }, { id: 'b', weight: 3 }];
const wrong = (subject_id: string, n: number, error_reason: string | null = 'conteudo'): ReplanAttempt[] =>
  Array.from({ length: n }, () => ({ subject_id, correct: false, error_reason, created_at: '2030-03-09T12:00:00Z' }));
const right = (subject_id: string, n: number): ReplanAttempt[] =>
  Array.from({ length: n }, () => ({ subject_id, correct: true, error_reason: null, created_at: '2030-03-09T12:00:00Z' }));
const sessionsOf = (r: ReturnType<typeof replan>) => r.tasks.filter((t) => t.kind === 'theory').map((t) => t.sessionId);

describe('reorganizar o cronograma', () => {
  it('leva a atrasada para o primeiro dia livre e empurra o resto, usando a consolidação', () => {
    const late = task('2030-03-09', 'theory'), d1 = task('2030-03-10', 'theory'), d2 = task('2030-03-11', 'theory');
    const consol = task('2030-03-12', 'consolidation'), exam = task('2030-03-20', 'exam', null);
    const r = replan([late, d1, d2, consol, exam], subjects, [], TODAY, NOW);
    expect(r.tasks.filter((t) => t.kind === 'theory').map((t) => [t.date, t.sessionId])).toEqual([
      ['2030-03-10', late.session_id], ['2030-03-11', d1.session_id], ['2030-03-12', d2.session_id],
    ]);
    expect(r.summary.absorbed.consolidation).toBe(1);
    expect(r.summary.overdueTheory).toBe(1);
    expect(r.supersede.sort()).toEqual([late.id, d1.id, d2.id, consol.id].sort());
    expect(r.supersede).not.toContain(exam.id);
  });
  it('nenhuma sessão pendente se perde nem se repete, mesmo com pouco espaço', () => {
    const list = [
      ...Array.from({ length: 6 }, (_, i) => task(`2030-03-0${i + 1}`, 'theory')),
      task('2030-03-10', 'theory'), task('2030-03-11', 'weekly_review'), task('2030-03-12', 'simulado', null), task('2030-03-13', 'eve', null),
    ];
    const r = replan(list, subjects, [], TODAY, NOW);
    expect(sessionsOf(r).sort()).toEqual(list.filter((t) => t.kind === 'theory').map((t) => t.session_id).sort());
    expect(r.summary.absorbed.weekly_review).toBe(1);
    expect(r.summary.crowdedDays).toBe(2);
    expect(r.tasks.map((t) => t.date)).toEqual(['2030-03-10', '2030-03-10', '2030-03-10', '2030-03-10', '2030-03-11', '2030-03-11', '2030-03-11']);
  });
  it('dia com duas sessões divide o tempo e a meta, e mantém a ordem', () => {
    const a = task('2030-03-08', 'theory'), b = task('2030-03-10', 'theory');
    const r = replan([a, b], subjects, [], TODAY, NOW);
    expect(r.tasks).toMatchObject([
      { date: '2030-03-10', position: 0, minutes: 60, goal: 10, sessionId: a.session_id },
      { date: '2030-03-10', position: 1, minutes: 60, goal: 10, sessionId: b.session_id },
    ]);
  });
  it('não mexe em tarefa feita, simulado, véspera nem prova', () => {
    const done = task('2030-03-09', 'theory', 'a', { done_at: '2030-03-09T10:00:00Z' }), future = task('2030-03-11', 'theory');
    const sim = task('2030-03-12', 'simulado', null), eve = task('2030-03-13', 'eve', null), exam = task('2030-03-14', 'exam', null);
    const late = task('2030-03-08', 'theory');
    const r = replan([done, late, future, sim, eve, exam], subjects, [], TODAY, NOW);
    for (const t of [done, sim, eve, exam]) expect(r.supersede).not.toContain(t.id);
    expect(r.tasks.every((t) => t.fromTaskId !== done.id)).toBe(true);
  });
  it('sessão no dia certo e sem atraso fica onde está (sem criar linha)', () => {
    const d1 = task('2030-03-10', 'theory'), d2 = task('2030-03-11', 'theory');
    const r = replan([d1, d2], subjects, [], TODAY, NOW);
    expect(r.tasks).toEqual([]);
    expect(r.supersede).toEqual([]);
  });
  it('revisão atrasada sai e é contada no resumo', () => {
    const old = task('2030-03-08', 'weekly_review'), day = task('2030-03-10', 'theory');
    const r = replan([old, day], subjects, [], TODAY, NOW);
    expect(r.supersede).toEqual([old.id]);
    expect(r.summary.overdueOther).toBe(1);
    expect(r.summary.overdueTheory).toBe(0);
  });
  it('sem nenhum dia livre até a prova, as sessões ficam atrasadas e isso é informado', () => {
    const late = task('2030-03-08', 'theory'), exam = task('2030-03-10', 'exam', null);
    const r = replan([late, exam], subjects, [], TODAY, NOW);
    expect(r.supersede).toEqual([]);
    expect(r.summary.unplaced).toBe(1);
  });
  it('os dias de reforço restantes vão mais para a matéria fraca', () => {
    const days = Array.from({ length: 8 }, (_, i) => task(`2030-03-${10 + i}`, 'consolidation', i % 2 ? 'a' : 'b'));
    const attempts = [...wrong('a', 20), ...right('b', 20)];
    const r = replan([task('2030-03-08', 'weekly_review'), ...days], subjects, attempts, TODAY, NOW);
    const count = (id: string) => days.filter((d) => {
      const moved = r.tasks.find((t) => t.date === d.date);
      return (moved ? moved.subjectId : d.subject_id) === id;
    }).length;
    expect(count('a')).toBeGreaterThan(count('b'));
    expect(count('a') + count('b')).toBe(8);
    expect(r.summary.weakest[0]).toBe('a');
  });
  it('tarefa de reforço com matéria nova leva o que era dela (tempo, meta e título)', () => {
    const day = task('2030-03-10', 'consolidation', 'b', { minutes: 90, goal_questions: 22, title: 'Questões' });
    const r = replan([day], [{ id: 'a', weight: 3 }], [], TODAY, NOW);
    expect(r.tasks).toMatchObject([{ date: '2030-03-10', kind: 'consolidation', subjectId: 'a', minutes: 90, goal: 22, title: 'Questões', fromTaskId: day.id }]);
    expect(r.supersede).toEqual([day.id]);
  });
});

describe('fraqueza da matéria e motivo do erro', () => {
  const weak = (a: ReplanAttempt[]) => subjectWeakness([{ id: 'a', weight: 1 }], a, NOW).get('a')!.weakness;
  it('sem questões, parte da mesma estimativa do foco adaptativo', () => {
    expect(weak([])).toBeCloseTo(0.3);
  });
  it('erro de atenção pesa menos que falta de conteúdo', () => {
    expect(weak(wrong('a', 10, 'atencao'))).toBeLessThan(weak(wrong('a', 10, 'conteudo')));
    expect(weak(wrong('a', 10, 'pegadinha'))).toBeCloseTo(weak(wrong('a', 10, 'conteudo')));
  });
  it('resultados antigos valem menos', () => {
    const old: ReplanAttempt[] = wrong('a', 10).map((x) => ({ ...x, created_at: '2029-01-01T00:00:00Z' }));
    expect(weak(old)).toBeLessThan(weak(wrong('a', 10)));
  });
  it('atrasadas: só o que passou, sem feitas nem a prova', () => {
    const list = [task('2030-03-09', 'theory'), task('2030-03-09', 'theory', 'a', { done_at: 'x' }), task('2030-03-10', 'theory'), task('2030-03-09', 'exam', null)];
    expect(overdueTasks(list, TODAY).map((t) => t.id)).toEqual([list[0]!.id]);
  });
});
