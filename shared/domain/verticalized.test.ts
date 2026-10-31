import { describe, expect, it } from 'vitest';
import { buildVerticalized, type VSession, type VStat, type VSubject, type VTask, type VTopic } from './verticalized.ts';

const subject = (id: string, over: Partial<VSubject> = {}): VSubject => ({ id, name: id, is_core: false, weight: 2, questions: 10, ...over });
const topic = (id: string, subject_id = 'penal'): VTopic => ({ id, subject_id, text: id });
const session = (id: string, topic_ids: string[], over: Partial<VSession> = {}): VSession => ({ id, subject_id: 'penal', plan_version_id: 'v2', topic_ids, ...over });
const task = (id: string, session_id: string, date: string, done = false, over: Partial<VTask> = {}): VTask => ({ id, session_id, date, done_at: done ? `${date}T12:00:00Z` : null, superseded_in_version: null, ...over });
const stat = (session_id: string, total: number, correct: number, last_at = '2026-10-01T10:00:00Z'): VStat => ({ session_id, total, correct, last_at });
const build = (over: { subjects?: VSubject[]; topics?: VTopic[]; sessions?: VSession[]; tasks?: VTask[]; stats?: VStat[] }) =>
  buildVerticalized({ subjects: [subject('penal')], topics: [topic('t1')], sessions: [], tasks: [], stats: [], activeVersionId: 'v2', ...over });
const row = (r: ReturnType<typeof build>, id = 't1') => r.subjects.flatMap((s) => s.topics).find((t) => t.id === id)!;

describe('situação do tópico', () => {
  it('estudado só com todas as sessões feitas', () => {
    const sessions = [session('s1', ['t1']), session('s2', ['t1'])];
    const parcial = row(build({ sessions, tasks: [task('a', 's1', '2026-10-01', true), task('b', 's2', '2026-10-02')] }));
    expect(parcial).toMatchObject({ status: 'andamento', sessionsDone: 1, sessionsTotal: 2 });
    const tudo = row(build({ sessions, tasks: [task('a', 's1', '2026-10-01', true), task('b', 's2', '2026-10-02', true)] }));
    expect(tudo.status).toBe('estudado');
  });
  it('sem nada feito fica pendente; questões respondidas já contam como andamento', () => {
    const sessions = [session('s1', ['t1'])];
    expect(row(build({ sessions, tasks: [task('a', 's1', '2026-10-01')] })).status).toBe('pendente');
    expect(row(build({ sessions, stats: [stat('s1', 1, 1)] })).status).toBe('andamento');
  });
  it('tópico sem sessão no cronograma aparece como fora', () => {
    expect(row(build({})).status).toBe('fora');
  });
  it('cronograma refeito: sessão antiga feita vale como andamento, com questões e data', () => {
    const r = row(build({
      sessions: [session('velha', ['t1'], { plan_version_id: 'v1' }), session('nova', ['t1'])],
      tasks: [task('a', 'velha', '2026-09-01', true, { superseded_in_version: 'v2' }), task('b', 'nova', '2026-11-01')],
      stats: [stat('velha', 4, 3, '2026-09-02T10:00:00Z')],
    }));
    expect(r).toMatchObject({ status: 'andamento', sessionsDone: 0, sessionsTotal: 1, attempts: 4, correct: 3, lastSeen: '2026-09-02T10:00:00Z' });
  });
});

describe('atalho para a tarefa', () => {
  it('vai para a próxima aberta; ignora tarefa substituída', () => {
    const r = row(build({
      sessions: [session('s1', ['t1']), session('s2', ['t1'])],
      tasks: [task('tarde', 's2', '2026-11-05'), task('cedo', 's1', '2026-11-01'), task('antiga', 's1', '2026-10-01', false, { superseded_in_version: 'v2' })],
    }));
    expect(r.taskId).toBe('cedo');
  });
  it('sem aberta, vai para a última feita; sem tarefa, null', () => {
    const sessions = [session('s1', ['t1'])];
    expect(row(build({ sessions, tasks: [task('a', 's1', '2026-10-01', true), task('b', 's1', '2026-10-05', true)] })).taskId).toBe('b');
    expect(row(build({ sessions })).taskId).toBeNull();
  });
});

describe('desempenho', () => {
  it('ponto fraco exige 5 questões e acerto abaixo de 75%', () => {
    const sessions = [session('s1', ['t1'])];
    expect(row(build({ sessions, stats: [stat('s1', 4, 0)] })).weak).toBe(false);
    expect(row(build({ sessions, stats: [stat('s1', 5, 3)] })).weak).toBe(true);
    expect(row(build({ sessions, stats: [stat('s1', 4, 3)] })).weak).toBe(false);
    expect(row(build({ sessions, stats: [stat('s1', 8, 6)] })).weak).toBe(false);
  });
  it('estudado sem questões fica marcado', () => {
    const sessions = [session('s1', ['t1'])];
    expect(row(build({ sessions, tasks: [task('a', 's1', '2026-10-01', true)] })).noQuestions).toBe(true);
    expect(row(build({ sessions, tasks: [task('a', 's1', '2026-10-01', true)], stats: [stat('s1', 1, 1)] })).noQuestions).toBe(false);
  });
  it('sessão com dois tópicos: conta nos dois, mas uma vez só na matéria e no total', () => {
    const r = build({ topics: [topic('t1'), topic('t2')], sessions: [session('s1', ['t1', 't2'])], stats: [stat('s1', 10, 8)] });
    expect(row(r, 't1').attempts).toBe(10);
    expect(row(r, 't2').attempts).toBe(10);
    expect(r.subjects[0]).toMatchObject({ attempts: 10, correct: 8, acc: 0.8 });
    expect(r.summary).toMatchObject({ attempts: 10, correct: 8, acc: 0.8 });
  });
  it('resumo sem dados não divide por zero', () => {
    expect(build({}).summary).toMatchObject({ total: 1, studied: 0, inProgress: 0, weak: 0, attempts: 0, acc: null });
  });
});

describe('onde focar', () => {
  it('prioriza quem erra mais e a matéria que pesa mais; no máximo 5', () => {
    const subjects = [subject('penal', { weight: 2 }), subject('civil', { weight: 5, is_core: true })];
    const topics = [topic('leve'), topic('grave'), topic('pesa', 'civil')];
    const sessions = [session('s1', ['leve']), session('s2', ['grave']), session('s3', ['pesa'], { subject_id: 'civil' })];
    const stats = [stat('s1', 10, 7), stat('s2', 10, 1), stat('s3', 10, 7)];
    expect(build({ subjects, topics, sessions, stats }).focus.map((t) => t.id)).toEqual(['pesa', 'grave', 'leve']);

    const many = Array.from({ length: 8 }, (_, i) => `t${i}`);
    const r = build({ topics: many.map((id) => topic(id)), sessions: many.map((id) => session(`s-${id}`, [id])), stats: many.map((id) => stat(`s-${id}`, 10, 0)) });
    expect(r.focus).toHaveLength(5);
    expect(r.summary.weak).toBe(8);
  });
});
