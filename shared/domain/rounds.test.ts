import { describe, expect, it } from 'vitest';
import { generateSchedule } from './scheduler.ts';
import { firstPassWeeks, isOpenEnded, masteryPercent, needsRound, nextRound, openEndDate, type RoundAttempt } from './rounds.ts';
import type { ReplanTask } from './replan.ts';

const TODAY = '2026-11-02', NOW = new Date('2026-11-02T12:00:00Z').getTime(); // segunda-feira
const daysAgo = (n: number) => new Date(NOW - n * 864e5).toISOString();
const done = (session: string, subject: string, ago = 7, over: Partial<ReplanTask> = {}): ReplanTask => ({
  id: `t-${session}`, date: '2026-10-01', minutes: 120, kind: 'theory', subject_id: subject, session_id: session, title: `Tema ${session}`, keyword: session, goal_questions: 10, done_at: daysAgo(ago), ...over,
});
const answers = (session: string, subject: string, right: number, wrong: number, ago = 3): RoundAttempt[] => [
  ...Array.from({ length: right }, () => ({ session_id: session, subject_id: subject, correct: true, error_reason: null, created_at: daysAgo(ago) })),
  ...Array.from({ length: wrong }, () => ({ session_id: session, subject_id: subject, correct: false, error_reason: null, created_at: daysAgo(ago) })),
];
const subjects = [{ id: 'adm', weight: 5 }, { id: 'pt', weight: 3 }, { id: 'info', weight: 1 }];
const hours = [2, 2, 2, 2, 2, 4, 0];
const base = { subjects, hours, weeklyReview: false, totalQuestions: 0, today: TODAY, now: NOW };

describe('isOpenEnded', () => {
  it('só prova já realizada vira plano sem prazo', () => {
    expect(isOpenEnded('2025-03-14', TODAY)).toBe(true);
    expect(isOpenEnded(TODAY, TODAY)).toBe(false);
    expect(isOpenEnded('2030-01-01', TODAY)).toBe(false);
    expect(isOpenEnded(null, TODAY)).toBe(false);
  });
});

describe('primeira volta', () => {
  it('dimensiona pelo conteúdo, sem prova, véspera, simulado nem reta final', () => {
    const topics = [30, 20, 2];
    const end = openEndDate(TODAY, hours, true, topics);
    const names = ['a', 'b', 'c'];
    const r = generateSchedule(
      { startDate: TODAY, examDate: end, openEnded: true, subjects: names.map((name) => ({ name, core: false })) },
      { hours, weeklyReview: true, subjects: Object.fromEntries(names.map((n, i) => [n, { weight: 3, level: 1, topics: Array.from({ length: topics[i]! }, (_, k) => `t${k}`) }])) },
    );
    const kinds = new Set(r.weeks.flatMap((w) => w.days.map((d) => d.kind)));
    for (const k of ['exam', 'eve', 'simulado', 'consolidation', 'final_review'] as const) expect(kinds.has(k)).toBe(false);
    expect(kinds.has('theory')).toBe(true);
    expect(kinds.has('weekly_review')).toBe(true);
    expect(r.summary.theory).toBeGreaterThanOrEqual(54); // 30 + 20 + o mínimo de 4 sessões
    expect(r.summary.theory).toBeLessThan(70);
  });
  it('limita o tamanho em editais enormes', () => {
    const end = openEndDate(TODAY, [3, 0, 0, 0, 0, 0, 0], false, [1000]);
    expect(end).toBe('2030-04-22'); // 180 semanas + 1
  });
  it('estima o ritmo pelos dias de estudo', () => {
    expect(firstPassWeeks(60, hours)).toBe(10);
    expect(firstPassWeeks(61, hours)).toBe(11);
    expect(firstPassWeeks(5, [0, 0, 0, 0, 0, 0, 0])).toBe(5);
  });
});

describe('needsRound', () => {
  it('só com a fila acabando e algo já estudado', () => {
    const pending = (n: number) => Array.from({ length: n }, (_, i) => done(`p${i}`, 'adm', 1, { done_at: null, id: `p${i}` }));
    expect(needsRound([done('a', 'adm'), ...pending(2)])).toBe(true);
    expect(needsRound([done('a', 'adm'), ...pending(3)])).toBe(false);
    expect(needsRound(pending(1))).toBe(false);
  });
});

describe('nextRound', () => {
  const theory = (ids: string[], subject: string) => ids.map((id) => done(id, subject));
  const tasks = [...theory(['a1', 'a2', 'a3', 'a4', 'a5', 'a6'], 'adm'), ...theory(['p1', 'p2', 'p3', 'p4'], 'pt'), ...theory(['i1', 'i2', 'i3'], 'info')];

  it('preenche os dias de estudo das duas semanas e não usa dia sem horas', () => {
    const r = nextRound({ ...base, tasks, attempts: [] })!;
    expect(r.tasks).toHaveLength(12);
    expect(r.tasks.every((t) => new Date(`${t.date}T12:00:00`).getDay() !== 0)).toBe(true);
    expect(r.tasks[0]!.date).toBe(TODAY);
    expect(r.supersede).toEqual([]);
  });
  it('matéria fraca recebe mais dias que outra de mesmo peso', () => {
    const same = [{ id: 'adm', weight: 4 }, { id: 'pt', weight: 4 }, { id: 'info', weight: 4 }];
    const many = ['adm', 'pt', 'info'].flatMap((s) => theory(Array.from({ length: 8 }, (_, i) => `${s}${i}`), s));
    const attempts = [...answers('adm0', 'adm', 4, 16), ...answers('pt0', 'pt', 18, 2), ...answers('info0', 'info', 18, 2)];
    const r = nextRound({ ...base, subjects: same, tasks: many, attempts })!;
    const n = (s: string) => r.tasks.filter((t) => t.subjectId === s).length;
    expect(n('adm')).toBeGreaterThan(n('pt'));
    expect(n('pt')).toBeGreaterThanOrEqual(1);
    expect(n('info')).toBeGreaterThanOrEqual(1);
  });
  it('dentro da matéria, põe primeiro a sessão fraca, com reforço no título', () => {
    const attempts = [...answers('p1', 'pt', 1, 9), ...answers('a1', 'adm', 10, 0)];
    const r = nextRound({ ...base, tasks, attempts })!;
    const fraca = r.tasks.find((t) => t.subjectId === 'pt')!;
    expect(fraca.sessionId).toBe('p1');
    expect(fraca.title).toBe('Reforço: Tema p1');
    expect(fraca.goal).toBeGreaterThanOrEqual(5);
    expect(fraca.goal).toBeLessThanOrEqual(10);
    expect(r.summary.round.weakest[0]!.subjectId).toBe('pt');
  });
  it('sessão dominada aparece como manutenção, e não como reforço', () => {
    const attempts = subjects.flatMap((s) => tasks.filter((t) => t.subject_id === s.id).flatMap((t) => answers(t.session_id!, s.id, 20, 0)));
    const r = nextRound({ ...base, tasks, attempts })!;
    expect(r.tasks.every((t) => t.title.startsWith('Manutenção: '))).toBe(true);
    expect(r.summary.round.weakest).toEqual([]);
  });
  it('sem dados de desempenho, nada é chamado de reforço', () => {
    const r = nextRound({ ...base, tasks, attempts: [] })!;
    expect(r.tasks.every((t) => t.title.startsWith('Manutenção: '))).toBe(true);
    expect(r.summary.round.weakest).toEqual([]);
  });
  it('nenhuma matéria passa de 40% da rodada', () => {
    const r = nextRound({ ...base, tasks, attempts: answers('a1', 'adm', 0, 20) })!;
    const adm = r.tasks.filter((t) => t.subjectId === 'adm').length;
    expect(adm).toBeLessThanOrEqual(Math.ceil(r.tasks.length * 0.4));
  });
  it('sem dias para todas as matérias, ficam as há mais tempo sem estudo, mesmo com peso baixo', () => {
    const old = [...theory(['a1', 'a2'], 'adm'), ...theory(['p1'], 'pt'), done('i1', 'info', 40)];
    const r = nextRound({ ...base, hours: [2, 0, 0, 0, 0, 0, 0], tasks: old, attempts: [] })!;
    expect(r.tasks).toHaveLength(2);
    expect(r.tasks.map((t) => t.subjectId)).toContain('info');
  });
  it('toda matéria aparece na rodada, mesmo com peso baixo', () => {
    const r = nextRound({ ...base, tasks, attempts: [] })!;
    expect(new Set(r.tasks.map((t) => t.subjectId))).toEqual(new Set(['adm', 'pt', 'info']));
  });
  it('não repete a mesma matéria em dias seguidos quando os pesos permitem', () => {
    const same = [{ id: 'adm', weight: 3 }, { id: 'pt', weight: 3 }, { id: 'info', weight: 3 }];
    const many = ['adm', 'pt', 'info'].flatMap((s) => theory(Array.from({ length: 8 }, (_, i) => `${s}${i}`), s));
    const r = nextRound({ ...base, subjects: same, tasks: many, attempts: [] })!;
    const seq = r.tasks.map((t) => t.subjectId);
    expect(seq.slice(1).some((s, i) => s === seq[i])).toBe(false);
  });
  it('com poucas sessões, repete em vez de deixar dia vazio', () => {
    const r = nextRound({ ...base, tasks: theory(['a1'], 'adm'), attempts: [] })!;
    expect(r.tasks).toHaveLength(12);
  });
  it('simulado na segunda semana, no dia mais longo, e não de novo antes de 4 semanas', () => {
    const first = nextRound({ ...base, tasks, attempts: [], totalQuestions: 60 })!;
    const sim = first.tasks.filter((t) => t.kind === 'simulado');
    expect(sim).toHaveLength(1);
    expect(sim[0]).toMatchObject({ date: '2026-11-14', goal: 60, minutes: 240 });
    expect(first.summary.round.simulado).toBe(true);
    const recent = done('s', 'adm', 5, { kind: 'simulado', date: '2026-10-20', session_id: null, subject_id: null });
    expect(nextRound({ ...base, tasks: [...tasks, recent], attempts: [], totalQuestions: 60 })!.tasks.some((t) => t.kind === 'simulado')).toBe(false);
    const old = { ...recent, date: '2026-09-30' };
    expect(nextRound({ ...base, tasks: [...tasks, old], attempts: [], totalQuestions: 60 })!.tasks.some((t) => t.kind === 'simulado')).toBe(true);
  });
  it('mantém a revisão semanal pedida no questionário', () => {
    const r = nextRound({ ...base, tasks, attempts: [], weeklyReview: true })!;
    expect(r.tasks.filter((t) => t.kind === 'weekly_review').map((t) => t.date)).toEqual(['2026-11-07', '2026-11-14']);
  });
  it('não acumula prefixo no título ao passar por várias rodadas', () => {
    const again = [done('a1', 'adm', 1, { id: 'novo', kind: 'consolidation', title: 'Reforço: Tema a1' })];
    expect(nextRound({ ...base, tasks: again, attempts: [] })!.tasks[0]!.title).toMatch(/^(Reforço|Manutenção): Tema a1$/);
  });
  it('sem nada estudado ou sem horas, não monta rodada', () => {
    expect(nextRound({ ...base, tasks: [], attempts: [] })).toBeNull();
    expect(nextRound({ ...base, hours: [0, 0, 0, 0, 0, 0, 0], tasks, attempts: [] })).toBeNull();
  });
});

describe('masteryPercent', () => {
  const tasks = [done('a1', 'adm'), done('a2', 'adm'), done('p1', 'pt')];
  const two = [{ id: 'adm', weight: 3 }, { id: 'pt', weight: 1 }];
  it('pondera pelo peso da matéria, dividido entre as sessões', () => {
    expect(masteryPercent(tasks, two, [], NOW)).toBe(0);
    expect(masteryPercent(tasks, two, answers('p1', 'pt', 10, 0), NOW)).toBe(25);
    expect(masteryPercent(tasks, two, answers('a1', 'adm', 10, 0), NOW)).toBe(38);
    expect(masteryPercent(tasks, two, [...answers('a1', 'adm', 8, 2), ...answers('a2', 'adm', 9, 1), ...answers('p1', 'pt', 10, 0)], NOW)).toBe(100);
  });
  it('exige 10 questões e 80% de acerto', () => {
    expect(masteryPercent(tasks, two, answers('p1', 'pt', 9, 0), NOW)).toBe(0);
    expect(masteryPercent(tasks, two, answers('p1', 'pt', 7, 3), NOW)).toBe(0);
  });
  it('olha só as 10 últimas: erro recente tira o domínio', () => {
    const attempts = [...answers('p1', 'pt', 0, 5, 1), ...answers('p1', 'pt', 20, 0, 10)];
    expect(masteryPercent(tasks, two, attempts, NOW)).toBe(0);
  });
  it('tema sem ver há mais de 60 dias deixa de contar', () => {
    const stale = [done('p1', 'pt', 90)];
    expect(masteryPercent(stale, two, answers('p1', 'pt', 10, 0, 90), NOW)).toBe(0);
  });
  it('reforço não conta como sessão nova no total', () => {
    const extra = done('a1', 'adm', 1, { id: 'r', kind: 'consolidation' });
    expect(masteryPercent([...tasks, extra], two, answers('p1', 'pt', 10, 0), NOW)).toBe(25);
  });
});
