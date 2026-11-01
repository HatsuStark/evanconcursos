import { describe, expect, it } from 'vitest';
import { theoryGoal } from '../domain/scheduler.ts';
import { buildPlanPayload, carryOverSessions, theoryPlan, type PlanBase } from './plan-build.ts';
import { fallbackSessions, repairSessions, type SubjectSessions } from './plan.ts';

function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; }; }
const topicsOf = (n: number) => Array.from({ length: n }, (_, i) => `Tópico ${i + 1}: assunto ${i + 1}`);

// Invariantes que o cronograma depende: exatamente n sessões, índices válidos, todo tópico coberto.
function assertValid(sessions: { topics: number[]; title: string }[], n: number, T: number) {
  expect(sessions).toHaveLength(n);
  for (const s of sessions) {
    expect(s.title.length).toBeGreaterThan(0);
    for (const t of s.topics) { expect(Number.isInteger(t)).toBe(true); expect(t).toBeGreaterThanOrEqual(0); expect(t).toBeLessThan(T); }
  }
  const covered = new Set(sessions.flatMap((s) => s.topics));
  for (let t = 0; t < T; t++) expect(covered.has(t), `tópico ${t}`).toBe(true);
}

describe('repairSessions: qualquer resposta da IA vira n sessões cobrindo todos os tópicos', () => {
  it('500 respostas aleatórias (faltando, sobrando, índices inválidos, títulos vazios)', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const r = rng(seed), int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
      const T = int(1, 40), n = int(1, 60);
      const raw: SubjectSessions = {
        sessions: Array.from({ length: int(0, 80) }, (_, i) => ({
          title: r() < 0.05 ? '' : `Sessão ${i}`, keyword: r() < 0.3 ? '' : `kw${i}`,
          topics: Array.from({ length: int(0, 4) }, () => int(-2, T + 3)),
        })),
      };
      const { sessions } = repairSessions(raw, n, topicsOf(T));
      assertValid(sessions, n, T);
    }
  });
  it('resposta correta passa sem correções', () => {
    const raw: SubjectSessions = { sessions: [{ title: 'A: x', keyword: 'a', topics: [1, 2] }, { title: 'B: y', keyword: 'b', topics: [3] }] };
    const r = repairSessions(raw, 2, topicsOf(3));
    expect(r.fixes).toEqual([]);
    expect(r.sessions.map((s) => s.topics)).toEqual([[0, 1], [2]]);
  });
  it('fallback sem IA também cumpre os invariantes', () => {
    for (const [T, n] of [[1, 1], [3, 10], [10, 3], [7, 7], [40, 1], [1, 25]] as const) assertValid(fallbackSessions(topicsOf(T), n), n, T);
  });
});

describe('carryOverSessions', () => {
  const s = (title: string, topics: number[]) => ({ title, keyword: '', topics });
  it('põe o novo antes e marca como revisão só o que foi todo estudado', () => {
    const r = carryOverSessions([s('A', [0]), s('B', [1]), s('C', [0, 1]), s('D', [])], ['t0', 't1'], new Set(['t0']));
    expect(r.sessions.map((x) => x.title)).toEqual(['B', 'C', 'D', 'A']);
    expect([...r.review]).toEqual([3]);
  });
  it('tópico inexistente não conta como estudado', () => {
    expect(carryOverSessions([s('A', [9])], ['t0'], new Set(['t0'])).review.size).toBe(0);
  });
  it('a tarefa da sessão já estudada é de revisão, e a sessão guarda o título original', () => {
    const base: PlanBase = { examDate: '2027-06-01', totalQuestions: 10, weights: {}, inputs: { hours: [2, 2, 2, 2, 2, 0, 0], startDate: '2026-11-02', weeklyReview: false, profile: '', levels: {} },
      subjects: [{ id: 'a', name: 'A', core: true, questions: 5, weight: 3, topics: [{ id: 't0', text: 'x' }, { id: 't1', text: 'y' }] }] };
    const n = theoryPlan(base).a!.days;
    const list = Array.from({ length: n }, (_, i) => s(`Sessão ${i}`, [i === 0 ? 0 : 1]));
    const { sessions, review } = carryOverSessions(list, ['t0', 't1'], new Set(['t0']));
    const p = buildPlanPayload(base, { a: sessions }, { a: review });
    const theory = p.tasks.filter((t) => t.kind === 'theory');
    expect(theory[0]!.title).toBe('Sessão 1');
    expect(theory[theory.length - 1]!.title).toBe('Revisão: Sessão 0');
    expect(p.sessions[n - 1]!.title).toBe('Sessão 0');
  });
});

describe('buildPlanPayload', () => {
  const base: PlanBase = {
    examDate: '2027-03-14', totalQuestions: 70,
    inputs: { hours: [2, 2, 2, 2, 2, 4, 0], startDate: '2026-11-04', weeklyReview: true, profile: '', levels: { p: 0, l: 2 } },
    weights: { p: 5, l: 3, i: 1 },
    subjects: [
      { id: 'p', name: 'Penal', core: true, questions: 0, weight: 3, topics: topicsOf(12).map((text, i) => ({ id: `p${i}`, text })) },
      { id: 'l', name: 'Português', core: false, questions: 16, weight: 3, topics: topicsOf(8).map((text, i) => ({ id: `l${i}`, text })) },
      { id: 'i', name: 'Informática', core: false, questions: 9, weight: 2, topics: topicsOf(3).map((text, i) => ({ id: `i${i}`, text })) },
    ],
  };
  const counts = theoryPlan(base);
  const sessions = Object.fromEntries(base.subjects.map((s) => [s.id, fallbackSessions(s.topics.map((t) => t.text), counts[s.id]!.days)]));
  const p = buildPlanPayload(base, sessions);
  const theory = p.tasks.filter((t) => t.kind === 'theory');

  it('cada sessão vira exatamente uma tarefa de teoria, na ordem da matéria', () => {
    expect(theory).toHaveLength(p.sessions.length);
    expect(new Set(theory.map((t) => t.sessionKey)).size).toBe(p.sessions.length);
    for (const s of base.subjects) {
      const keys = theory.filter((t) => t.subjectId === s.id).map((t) => t.sessionKey);
      expect(keys).toEqual(keys.slice().sort((a, b) => Number(a!.split(':')[1]) - Number(b!.split(':')[1])));
    }
  });
  it('todo tópico do edital é coberto por alguma sessão agendada', () => {
    const covered = new Set(p.sessions.flatMap((s) => s.topicIds));
    for (const s of base.subjects) for (const t of s.topics) expect(covered.has(t.id), t.id).toBe(true);
  });
  it('datas: nada antes do início, nada depois da prova, domingo livre, prova no dia certo', () => {
    expect(p.tasks.every((t) => t.date >= '2026-11-04' && t.date <= '2027-03-14')).toBe(true);
    expect(p.tasks.filter((t) => new Date(t.date + 'T12:00:00').getDay() === 0 && t.kind !== 'exam')).toHaveLength(0);
    expect(p.tasks.find((t) => t.kind === 'exam')?.date).toBe('2027-03-14');
    expect(p.tasks.find((t) => t.kind === 'eve')?.date).toBe('2027-03-13');
    expect(new Set(p.tasks.map((t) => t.date)).size).toBe(p.tasks.length); // uma tarefa por dia
  });
  it('minutos respeitam as horas do dia; metas coerentes', () => {
    for (const t of p.tasks) {
      const wd = (new Date(t.date + 'T12:00:00').getDay() + 6) % 7;
      if (t.kind !== 'exam') expect(t.minutes).toBe(base.inputs.hours[wd]! * 60);
    }
    expect(theory.every((t) => t.goal === theoryGoal(t.minutes))).toBe(true);
    expect(p.tasks.filter((t) => t.kind === 'simulado').every((t) => t.goal === 70)).toBe(true);
  });
  it('prioridade: mais dias para quem tem mais peso e menos nível', () => {
    expect(counts.p!.days).toBeGreaterThan(counts.l!.days);
    expect(counts.l!.days).toBeGreaterThan(counts.i!.days);
  });
  it('recusa sessões em número diferente do reservado', () => {
    expect(() => buildPlanPayload(base, { ...sessions, i: sessions.i!.slice(1) })).toThrow(/esperadas/);
  });
});
