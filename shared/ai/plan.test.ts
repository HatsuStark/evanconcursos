import { describe, expect, it } from 'vitest';
import { theoryGoal } from '../domain/scheduler.ts';
import { buildPlanPayload, carryOverSessions, questionsOf, theoryPlan, type PlanBase } from './plan-build.ts';
import { allocateSessions, fallbackSessions, isShortLaw, mergeShortLawSessions, repairSessions, type SubjectSessions } from './plan.ts';
import { findLawRefs } from '../legal/refs.ts';

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
      { id: 'p', name: 'Penal', core: true, questions: 20, weight: 3, topics: topicsOf(12).map((text, i) => ({ id: `p${i}`, text })) },
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
  });
  it('dia com vários blocos, em posições seguidas, de matérias diferentes (Penal domina: repetição rara e espalhada)', () => {
    const byDate = new Map<string, typeof p.tasks>();
    for (const t of p.tasks) byDate.set(t.date, [...(byDate.get(t.date) ?? []), t]);
    const lists = [...byDate.values()], multi = lists.filter((l) => l.length >= 2);
    expect(multi.length).toBeGreaterThan(byDate.size / 2);
    for (const l of lists) expect(l.map((t) => t.position)).toEqual(l.map((_, i) => i));
    const repeated = multi.map((l, i) => ({ i, s: l.filter((t) => t.kind !== 'lei_seca' && t.subjectId).map((t) => t.subjectId) })).filter((x) => new Set(x.s).size !== x.s.length);
    expect(repeated.length).toBeLessThanOrEqual(multi.length * 0.15);
    expect(repeated.filter((x) => x.i >= multi.length * 0.66).length).toBeLessThan(Math.max(2, repeated.length));
  });
  it('minutos do dia somam as horas (70% na semana leve); metas coerentes', () => {
    const byDate = new Map<string, number>();
    for (const t of p.tasks) if (t.kind !== 'exam') byDate.set(t.date, (byDate.get(t.date) ?? 0) + t.minutes);
    for (const [date, minutes] of byDate) {
      const h = base.inputs.hours[(new Date(date + 'T12:00:00').getDay() + 6) % 7]! * 60;
      expect([h, Math.round(h * 0.7)], date).toContain(minutes);
    }
    expect(theory.every((t) => [0, 0.5, 0.9].some((p) => t.goal === theoryGoal(t.minutes, p)))).toBe(true);
    expect(theory[theory.length - 1]!.goal).toBeGreaterThan(theory[0]!.goal);
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

describe('questionsOf', () => {
  const sub = (id: string, questions: number, block?: string) => ({ id, name: id, core: false, questions, weight: 2, block, topics: [] });
  const base = (subjects: ReturnType<typeof sub>[], blocks?: { name: string; questions: number }[]): PlanBase => ({
    examDate: '2027-03-14', totalQuestions: 70, weights: {}, blocks, subjects,
    inputs: { hours: [2, 2, 2, 2, 2, 0, 0], startDate: '2026-11-02', weeklyReview: false, profile: '', levels: {} },
  });
  it('divide as questões do bloco entre as matérias dele sem número no edital', () => {
    const r = questionsOf(base([sub('pt', 15, 'Bloco I'), sub('dp', 0, 'Bloco II'), sub('dc', 0, 'Bloco II'), sub('mat', 7, 'Bloco III')],
      [{ name: 'Bloco I', questions: 15 }, { name: 'BLOCO II', questions: 40 }, { name: 'Bloco III', questions: 15 }]));
    expect(r).toEqual({ pt: 15, dp: 20, dc: 20, mat: 7 });
  });
  it('sem bloco, usa o que falta no total da prova', () => {
    expect(questionsOf(base([sub('a', 30), sub('b', 0), sub('c', 0)]))).toEqual({ a: 30, b: 20, c: 20 });
  });
});

describe('sessão de lei quase vazia', () => {
  const size = (law: string, ranges: string, liveChars: number, liveArticles: number, revokedArticles: number) => [{ law, short: law, ranges, liveChars, liveArticles, revokedArticles }];
  const s = (title: string, topics: number[]) => ({ title, keyword: '', topics, incidence: 2 });
  it('artigos revogados ou só remissivos: junta à sessão mais próxima da mesma lei, com os artigos no título', () => {
    const r = mergeShortLawSessions(
      [s('Disposições Gerais: Normas da CGJ (arts. 1º a 4º)', [1]), s('Execução fiscal: Lei 6.830/80 (arts. 1º a 8º)', [1]), s('Carga de Autos: Normas da CGJ (arts. 105 a 110)', [1]), s('Mandados: Normas da CGJ (arts. 994 a 1.091-A)', [1, 2])],
      [size('NSCGJ', 'arts. 1 a 4', 2500, 4, 0), size('L6830', 'arts. 1 a 8', 3000, 8, 0), size('NSCGJ', 'arts. 105 a 110', 360, 1, 5), size('NSCGJ', 'arts. 994 a 1.091-A', 60000, 90, 3)]);
    expect(r.sessions.map((x) => x.title)).toEqual(['Disposições Gerais: Normas da CGJ (arts. 1º a 4º)', 'Execução fiscal: Lei 6.830/80 (arts. 1º a 8º)', 'Mandados: Normas da CGJ (arts. 994 a 1.091-A); NSCGJ, arts. 105 a 110']);
    expect(r.merged).toHaveLength(1);
  });
  it('sessão toda revogada some sem levar artigos para o título da vizinha', () => {
    const r = mergeShortLawSessions([s('Prazos e Certidões: Normas da CGJ (arts. 1.046 a 1.070)', [1]), s('Despesas: NSCGJ (arts. 1.071 a 1.091-A)', [2])],
      [size('NSCGJ', 'arts. 1.046 a 1.070', 9000, 20, 1), size('NSCGJ', 'arts. 1.071 a 1.091-A', 0, 0, 22)]);
    expect(r.sessions).toEqual([{ ...s('Prazos e Certidões: Normas da CGJ (arts. 1.046 a 1.070)', [1, 2]) }]);
  });
  it('sessão com texto suficiente ou sem lei medida fica como está', () => {
    const list = [s('Princípios: CPC (arts. 1º a 12)', [1]), s('Competência', [2])];
    expect(mergeShortLawSessions(list, [size('CPC', 'arts. 1 a 12', 2400, 12, 0), null]).sessions).toEqual(list);
  });
  it('maioria revogada com pouco texto vigente também conta como curta', () => {
    expect(isShortLaw(size('NSCGJ', 'arts. 1 a 6', 1200, 2, 4))).toBe(true);
    expect(isShortLaw(size('CPC', 'arts. 1 a 4', 800, 4, 0))).toBe(false);
  });
  it('o título juntado aponta os artigos das duas sessões', () => {
    expect(findLawRefs('Mandados: Normas da CGJ (arts. 994 a 1.091-A); NSCGJ, arts. 105 a 110')).toEqual([{ law: 'NSCGJ', ranges: [{ from: 994, to: 1091, toSuffix: 'A' }, { from: 105, to: 110 }] }]);
  });
});

describe('dias distribuídos pelo conteúdo e pela cobrança', () => {
  const art = (num: number, chars: number, revoked = false) => ({ label: String(num), num, suffix: '', chars, revoked });
  const law = (from: number, to: number, chars: number, revokedFrom = Infinity) => {
    const articles = Array.from({ length: to - from + 1 }, (_, i) => art(from + i, chars, from + i >= revokedFrom));
    const live = articles.filter((a) => !a.revoked);
    return [{ law: 'NSCGJ', short: 'NSCGJ', cite: 'NSCGJ', ranges: `arts. ${from} a ${to}`, liveChars: live.length * chars, liveArticles: live.length, revokedArticles: articles.length - live.length, articles }];
  };
  const s = (title: string, incidence = 2, topics = [0]) => ({ title, keyword: '', topics, incidence });
  it('lei longa vira partes com o intervalo de artigos no título; a curta não ganha dia', () => {
    const r = allocateSessions([s('Disposições Gerais: Normas da CGJ (arts. 1º a 4º)'), s('Oficiais de Justiça: Normas da CGJ (arts. 994 a 1.015)', 3)],
      [law(1, 4, 500), law(994, 1015, 1500)], 4, 75);
    expect(r.sessions.map((x) => x.title)).toEqual([
      'Disposições Gerais: Normas da CGJ (arts. 1º a 4º)',
      'Oficiais de Justiça (parte 1 de 3): NSCGJ, arts. 994 a 1.001',
      'Oficiais de Justiça (parte 2 de 3): NSCGJ, arts. 1.002 a 1.008',
      'Oficiais de Justiça (parte 3 de 3): NSCGJ, arts. 1.009 a 1.015',
    ]);
    expect(findLawRefs(r.sessions[2]!.title)).toEqual([{ law: 'NSCGJ', ranges: [{ from: 1002, to: 1008 }] }]);
  });
  it('artigo revogado não entra nas partes', () => {
    const r = allocateSessions([s('Despesas: NSCGJ (arts. 1.046 a 1.091)', 3)], [law(1046, 1091, 1500, 1054)], 2, 75);
    expect(r.sessions.map((x) => x.title)).toEqual(['Despesas (parte 1 de 2): NSCGJ, arts. 1.046 a 1.049', 'Despesas (parte 2 de 2): NSCGJ, arts. 1.050 a 1.053']);
  });
  it('sobrando dias, aprofunda a mais cobrada (não a curta), algumas sessões depois', () => {
    const list = [s('A: Normas da CGJ (arts. 1º a 4º)', 2), s('B: Normas da CGJ (arts. 10 a 12)', 3), s('C', 2), s('D', 2), s('E', 2)];
    const r = allocateSessions(list, [law(1, 4, 100), law(10, 12, 3000), null, null, null], 7, 75);
    expect(r.sessions.map((x) => x.title)).toEqual(['A: Normas da CGJ (arts. 1º a 4º)', 'B: Normas da CGJ (arts. 10 a 12)', 'C', 'D', 'E', 'Aprofundamento: B: Normas da CGJ (arts. 10 a 12)', 'Aprofundamento: C']);
  });
  it('até 2 aprofundamentos por sessão; o 2º é revisão com questões, mais longe', () => {
    const r = allocateSessions([s('X', 3), s('Y', 1), s('Z', 1), s('W', 1), s('V', 1), s('U', 1), s('T', 1)], [null, null, null, null, null, null, null], 9, 75);
    expect(r.sessions.filter((x) => x.title.endsWith('X')).map((x) => x.title)).toEqual(['X', 'Aprofundamento: X', 'Revisão com questões: X']);
    expect(r.sessions.findIndex((x) => x.title === 'Aprofundamento: X')).toBeGreaterThan(2);
  });
  it('faltando dias, junta as vizinhas de menor peso e leva os artigos no título', () => {
    const r = allocateSessions([s('A: NSCGJ (arts. 1 a 2)', 1), s('B: NSCGJ (arts. 3 a 4)', 1), s('C: NSCGJ (arts. 10 a 30)', 3)], [law(1, 2, 3000), law(3, 4, 3000), law(10, 30, 3000)], 2, 75);
    expect(r.sessions.map((x) => x.title)).toEqual(['A: NSCGJ (arts. 1 a 2); NSCGJ, arts. 3 a 4', 'C: NSCGJ (arts. 10 a 30)']);
  });
});
