import { describe, expect, it } from 'vitest';
import { addDays, answerOptions, applyAnswer, needsExample, offersRoadmap, checkClosed, conceptLevel, interleave, isNovice, markTaught, needsTeaching, dueConcepts, initialState, matchesText, progress, reportQuestion, scheduleAfterLesson, scheduleAfterReview, shuffledOrder, summarize, syncQueue, type AnswerLog, type Etapa, type TutorLesson, type TutorQuestion } from './tutor.ts';

const q = (id: string, etapa: Etapa, conceito: string, extra: Partial<TutorQuestion> = {}): TutorQuestion => ({
  id, etapa, conceito, estilo: 'conceito', formato: 'certo_errado', enunciado: id, alternativas: [], gabarito: 'C', aceitas: [], dica: '', explicacao: '', erros: [], ...extra,
});
const lesson: TutorLesson = {
  titulo: 'Tema',
  conceitos: ['c1', 'c2'].map((id) => ({ id, nome: id, essencial: '', explicacao: '', outro_jeito: '', base: '' })),
  questoes: [
    q('f1', 'fixacao', 'c1'), q('d1', 'diagnostico', 'c1'), q('d2', 'diagnostico', 'c2'),
    q('k2', 'construcao', 'c2'), q('k1', 'construcao', 'c1'), q('r1', 'reforco', 'c1'), q('a1', 'aplicacao', 'c1'), q('z1', 'final', 'c1'),
  ],
};
const log = (qid: string, etapa: Etapa, conceito: string, correct: boolean, extra: Partial<AnswerLog> = {}): AnswerLog =>
  ({ qid, etapa, conceito, correct, hint: false, explained: false, unknown: false, response: '', at: '', ...extra });

describe('fila da aula', () => {
  it('segue as etapas e a ordem dos conceitos, sem reforço', () => {
    expect(initialState(lesson).queue).toEqual(['d1', 'd2', 'k1', 'k2', 'a1', 'f1', 'z1']);
  });
  it('pula a construção dos conceitos já dominados', () => {
    const s = initialState(lesson, ['c1']);
    expect(s.queue).not.toContain('k1');
    expect(s.skipped).toEqual(['k1']);
  });
  it('acerto forte no diagnóstico tira a construção do conceito', () => {
    const s = applyAnswer(initialState(lesson), lesson, log('d1', 'diagnostico', 'c1', true));
    expect(s.queue).toEqual(['d2', 'k2', 'a1', 'f1', 'z1']);
    expect(s.known).toEqual(['c1']);
  });
  it('acerto com dica no diagnóstico não pula nada', () => {
    const s = applyAnswer(initialState(lesson), lesson, log('d1', 'diagnostico', 'c1', true, { hint: true }));
    expect(s.queue).toContain('k1');
  });
  it('erro na construção traz o reforço uma pergunta depois, uma vez só', () => {
    let s = initialState(lesson);
    s = applyAnswer(s, lesson, log('d1', 'diagnostico', 'c1', false));
    s = applyAnswer(s, lesson, log('d2', 'diagnostico', 'c2', false));
    s = applyAnswer(s, lesson, log('k1', 'construcao', 'c1', false));
    expect(s.queue.slice(0, 3)).toEqual(['k2', 'r1', 'a1']);
    s = applyAnswer(s, lesson, log('k2', 'construcao', 'c2', true));
    s = applyAnswer(s, lesson, log('r1', 'reforco', 'c1', false));
    s = applyAnswer(s, lesson, log('a1', 'aplicacao', 'c1', false));
    expect(s.queue).toEqual(['f1', 'z1']);
  });
  it('recebe as perguntas que chegam depois', () => {
    const partial = { ...lesson, questoes: lesson.questoes.filter((x) => ['diagnostico', 'construcao', 'reforco'].includes(x.etapa)) };
    let s = initialState(partial);
    s = applyAnswer(s, partial, log('d1', 'diagnostico', 'c1', true));
    s = syncQueue(s, lesson);
    expect(s.queue).toEqual(['d2', 'k2', 'a1', 'f1', 'z1']);
    expect(syncQueue(s, lesson)).toBe(s);
  });
  it('pergunta reportada sai da fila e do placar', () => {
    let s = applyAnswer(initialState(lesson), lesson, log('d1', 'diagnostico', 'c1', false));
    s = reportQuestion(s, 'd1');
    s = reportQuestion(s, 'd2');
    expect(s.logs).toEqual([]);
    expect(s.queue[0]).toBe('k1');
    expect(progress(s)).toEqual({ done: 0, total: 5, pct: 0 });
  });
});

describe('domínio do conceito', () => {
  it('acertar depois da explicação não é domínio', () => {
    expect(conceptLevel([log('k', 'construcao', 'c', false), log('f', 'fixacao', 'c', true, { explained: true }), log('z', 'final', 'c', true, { hint: true })])).toBe('em_progresso');
  });
  it('acerto forte na fixação e no final é domínio', () => {
    expect(conceptLevel([log('k', 'construcao', 'c', false), log('f', 'fixacao', 'c', true), log('z', 'final', 'c', true)])).toBe('dominado');
  });
  it('erro na verificação final pede atenção', () => {
    expect(conceptLevel([log('f', 'fixacao', 'c', true), log('z', 'final', 'c', false)])).toBe('atencao');
  });
  it('sem resposta não há nível', () => {
    expect(conceptLevel([])).toBeNull();
    expect(summarize(lesson, initialState(lesson))).toEqual([]);
  });
});

describe('revisão espaçada', () => {
  const today = '2026-11-18';
  it('aula: dominado começa em 3 dias, o resto em 1', () => {
    expect(scheduleAfterLesson(null, 'dominado', today).due_on).toBe('2026-11-21');
    expect(scheduleAfterLesson(null, 'atencao', today).due_on).toBe('2026-11-19');
  });
  it('revisão: forte avança, fraco repete, erro volta e encurta depois de esquecer duas vezes', () => {
    const m = { level: 'em_progresso' as const, step: 1, lapses: 0, reviews: 1, due_on: today };
    expect(scheduleAfterReview(m, 'forte', today)).toMatchObject({ step: 2, due_on: '2026-11-25', level: 'dominado', reviews: 2 });
    expect(scheduleAfterReview(m, 'fraco', today).due_on).toBe('2026-11-21');
    expect(scheduleAfterReview(m, 'erro', today)).toMatchObject({ step: 0, lapses: 1, level: 'atencao', due_on: '2026-11-19' });
    expect(scheduleAfterReview({ ...m, step: 3, lapses: 2 }, 'forte', today).due_on).toBe(addDays(today, 18));
  });
  it('não passa da véspera da prova', () => {
    expect(scheduleAfterLesson(null, 'dominado', today, '2026-11-20').due_on).toBe('2026-11-19');
    expect(scheduleAfterLesson(null, 'dominado', today, '2026-11-19').due_on).toBeNull();
  });
  it('vencidos: atenção primeiro, depois os mais atrasados', () => {
    const rows = [
      { id: 1, due_on: '2026-11-10', level: 'dominado' as const, lapses: 0 },
      { id: 2, due_on: '2026-11-18', level: 'atencao' as const, lapses: 1 },
      { id: 3, due_on: '2026-11-19', level: 'atencao' as const, lapses: 0 },
      { id: 4, due_on: '2026-11-12', level: 'em_progresso' as const, lapses: 0 },
    ];
    expect(dueConcepts(rows, today).map((r) => r.id)).toEqual([2, 4, 1]);
  });
});

describe('correção', () => {
  it('confere texto com tolerância', () => {
    const g = { gabarito: 'Princípio da legalidade', aceitas: ['legalidade'] };
    expect(matchesText('principio da legalidae', g)).toBe(true);
    expect(matchesText('a Legalidade', g)).toBe(true);
    expect(matchesText('moralidade', g)).toBe(false);
    expect(matchesText('', g)).toBe(false);
  });
  it('fechadas', () => {
    expect(checkClosed(q('x', 'final', 'c', { formato: 'multipla', gabarito: 'b' }), 'B')).toBe(true);
    expect(checkClosed(q('x', 'final', 'c', { gabarito: 'E' }), 'Errado')).toBe(true);
    expect(checkClosed(q('x', 'final', 'c', { formato: 'ordenacao', alternativas: ['a', 'b', 'c'] }), '0,1,2')).toBe(true);
    expect(checkClosed(q('x', 'final', 'c', { formato: 'curta' }), 'x')).toBeNull();
  });
  it('embaralha a ordenação sem deixar na ordem certa', () => {
    for (const id of ['a', 'b', 'q12', 'zz']) {
      const o = shuffledOrder(id, 4);
      expect([...o].sort()).toEqual([0, 1, 2, 3]);
      expect(o.join()).not.toBe('0,1,2,3');
      expect(shuffledOrder(id, 4)).toEqual(o);
    }
  });
});

describe('modo iniciante e intercalação', () => {
  it('diagnóstico fraco liga o modo iniciante ao terminar', () => {
    let s = initialState(lesson);
    s = applyAnswer(s, lesson, log('d1', 'diagnostico', 'c1', true, { hint: true }));
    expect(s.novice).toBeUndefined();
    s = applyAnswer(s, lesson, log('d2', 'diagnostico', 'c2', false, { unknown: true }));
    expect(s.novice).toBe(true);
    const k1 = lesson.questoes.find((x) => x.id === 'k1')!;
    expect(needsTeaching(s, k1)).toBe(true);
    expect(needsTeaching(markTaught(s, 'c1'), k1)).toBe(false);
    expect(isNovice([log('d1', 'diagnostico', 'c1', true), log('d2', 'diagnostico', 'c2', false)])).toBe(false);
  });
  it('intercala sem repetir conceito em sequência e de forma estável', () => {
    const qs = ['c1', 'c1', 'c2', 'c2', 'c3'].map((c, i) => q(`f${i}`, 'fixacao', c));
    const out = interleave(qs);
    expect(out).toHaveLength(5);
    expect(out.every((x, i) => i === 0 || x.conceito !== out[i - 1]!.conceito)).toBe(true);
    expect(interleave(qs).map((x) => x.id)).toEqual(out.map((x) => x.id));
  });
});

describe('opções da lacuna e da resposta curta', () => {
  const lac = (id: string, gabarito: string, extra: Partial<TutorQuestion> = {}) => q(id, 'fixacao', 'c1', { formato: 'lacuna', gabarito, ...extra });
  it('usa os distratores da pergunta, sem repetir a resposta', () => {
    const o = answerOptions(lac('l1', 'legalidade', { aceitas: ['princípio da legalidade'], distratores: ['moralidade', 'Legalidade', 'publicidade', 'eficiência', 'impessoalidade'] }));
    expect(o).toHaveLength(4);
    expect([...o].sort()).toEqual(['eficiência', 'legalidade', 'moralidade', 'publicidade']);
    expect(answerOptions(lac('l1', 'legalidade', { distratores: ['moralidade', 'publicidade', 'eficiência'] }))).toEqual(o);
  });
  it('sem distratores, completa com respostas de outras perguntas', () => {
    const pool = [lac('a', 'cinco dias'), lac('b', 'dez dias'), q('c', 'final', 'c1', { gabarito: 'E' }), lac('d', 'quinze dias úteis')];
    expect([...answerOptions(lac('x', 'trinta dias'), pool)].sort()).toEqual(['cinco dias', 'dez dias', 'quinze dias úteis', 'trinta dias']);
    expect(answerOptions(lac('x', 'trinta dias'))).toEqual(['trinta dias']);
  });
});

describe('exemplo resolvido', () => {
  const withEx: TutorLesson = { ...lesson, exemplo: { conceito: 'c1', caso: 'caso', passos: [{ pergunta: 'Quem?', resposta: 'Fulano' }], conclusao: 'fim' } };
  const a1 = lesson.questoes.find((x) => x.id === 'a1')!, a2 = q('a2', 'aplicacao', 'c2');
  it('aparece uma vez, antes da primeira aplicação', () => {
    const s = initialState(withEx);
    expect(needsExample(s, withEx, a1)).toBe(true);
    expect(needsExample({ ...s, exampleSeen: true }, withEx, a1)).toBe(false);
    expect(needsExample(s, lesson, a1)).toBe(false);
    expect(needsExample(s, withEx, lesson.questoes.find((x) => x.id === 'k1')!)).toBe(false);
  });
  it('o roteiro só acompanha a primeira situação-problema', () => {
    const s = initialState(withEx);
    expect(offersRoadmap(s, withEx, a1)).toBe(true);
    const after = applyAnswer(s, withEx, log('a1', 'aplicacao', 'c1', true));
    expect(offersRoadmap(after, withEx, a1)).toBe(true);
    expect(offersRoadmap(after, withEx, a2)).toBe(false);
  });
});
