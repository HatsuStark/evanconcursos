import { describe, expect, it } from 'vitest';
import { articleGaps, fillArticleGaps, isBareLawTopic, lawCite, requiredLaws, type LawArticle } from './plan-coverage.ts';
import { findLawRefs } from '../legal/refs.ts';
import { lawByKey } from '../legal/registry.ts';

const arts = (from: number, to: number, revoked: number[] = []): LawArticle[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ num: from + i, suffix: '', revoked: revoked.includes(from + i) }));

describe('cobertura de artigos do cronograma', () => {
  it('lei inteira só quando o tópico é só a citação da lei', () => {
    const l = lawByKey('L12153')!;
    expect(isBareLawTopic('3.3. Lei n.º 12.153 de 22/12/2009.', l)).toBe(true);
    expect(isBareLawTopic('Lei dos Juizados Especiais da Fazenda Pública (Lei 12.153/09)', l)).toBe(true);
    expect(isBareLawTopic('Lei 12.153/09: competência e recursos', l)).toBe(false);
    expect(isBareLawTopic('Lei 12.153/09, arts. 1º a 5º', l)).toBe(false);
    expect(isBareLawTopic('Juizados especiais e conciliação', l)).toBe(false);
  });

  it('lê do edital as faixas e as leis inteiras', () => {
    const r = requiredLaws([
      '3.1. Código de Processo Civil – artigos 144 a 155; 188 a 275',
      '3.2. Lei n.º 9.099 de 26.09.1995 (artigos 3º ao 19) e',
      '3.3. Lei n.º 12.153 de 22/12/2009.',
      'Constituição Federal: princípios fundamentais',
    ], 'Direito Processual Civil');
    expect(r).toEqual([
      { law: 'CPC', topic: 0, ranges: [{ from: 144, to: 155 }, { from: 188, to: 275 }] },
      { law: 'L9099', topic: 1, ranges: [{ from: 3, to: 19 }] },
      { law: 'L12153', topic: 2, ranges: [] },
    ]);
  });

  it('acha o que falta (buraco entre sessões e lei inteira), sem quebrar a faixa em artigo revogado', () => {
    const gaps = articleGaps([
      { law: 'CPC', topic: 0, ranges: [{ from: 188, to: 275 }], articles: arts(180, 280) },
      { law: 'L12153', topic: 2, ranges: [], articles: arts(1, 29, [12]) },
    ], [
      { refs: [{ law: 'CPC', ranges: [{ from: 188, to: 232 }] }] },
      { refs: [{ law: 'CPC', ranges: [{ from: 238, to: 275 }] }] },
      { refs: [{ law: 'L12153', ranges: [{ from: 2, to: 8 }] }] },
      { refs: null },
    ]);
    expect(gaps).toEqual([
      { law: 'CPC', topic: 0, ranges: [{ from: 233, to: 237 }] },
      { law: 'L12153', topic: 2, ranges: [{ from: 1, to: 1 }, { from: 9, to: 29 }] },
    ]);
  });

  it('tudo coberto: nada a fazer', () => {
    expect(articleGaps([{ law: 'L9099', topic: 1, ranges: [{ from: 3, to: 19 }], articles: arts(1, 97) }],
      [{ refs: [{ law: 'L9099', ranges: [{ from: 3, to: 9 }] }] }, { refs: [{ law: 'L9099', ranges: [{ from: 10, to: 19 }] }] }])).toEqual([]);
  });

  it('põe cada faixa na sessão mais próxima da mesma lei e cita no título', () => {
    const list = [
      { title: 'Prazos: CPC, arts. 218 a 232', topics: [0], refs: [{ law: 'CPC', ranges: [{ from: 218, to: 232 }] }] },
      { title: 'Citação: CPC, arts. 238 a 259', topics: [0], refs: [{ law: 'CPC', ranges: [{ from: 238, to: 259 }] }] },
      { title: 'Juizados da Fazenda: Lei 12.153, arts. 2º a 8º', topics: [2], refs: [{ law: 'L12153', ranges: [{ from: 2, to: 8 }] }] },
    ];
    const { sessions, fixes } = fillArticleGaps(list, [
      { law: 'CPC', topic: 0, ranges: [{ from: 233, to: 237 }] },
      { law: 'L12153', topic: 2, ranges: [{ from: 1, to: 1 }, { from: 9, to: 29 }] },
    ], (k) => lawCite(k));
    expect(sessions[0]!.title).toBe('Prazos: CPC, arts. 218 a 232; CPC, arts. 233 a 237');
    expect(sessions[0]!.refs).toEqual([{ law: 'CPC', ranges: [{ from: 218, to: 232 }, { from: 233, to: 237 }] }]);
    expect(sessions[1]).toEqual(list[1]);
    expect(sessions[2]!.title).toBe('Juizados da Fazenda: Lei 12.153, arts. 2º a 8º; Lei 12.153/09, arts. 1, 9 a 29');
    expect(fixes.map((f) => f.index)).toEqual([0, 2]);
    // O título novo continua apontando os mesmos artigos.
    expect(findLawRefs(sessions[2]!.title)[0]!.ranges).toEqual(expect.arrayContaining([{ from: 1, to: 1 }, { from: 9, to: 29 }]));
  });

  it('respeita as sessões aceitas (ex.: já estudadas ficam de fora) e cai no tópico quando não há sessão da lei', () => {
    const list = [
      { title: 'A: CPC, arts. 218 a 232', topics: [1], refs: [{ law: 'CPC', ranges: [{ from: 218, to: 232 }] }] },
      { title: 'B: CPC, arts. 260 a 275', topics: [1], refs: [{ law: 'CPC', ranges: [{ from: 260, to: 275 }] }] },
      { title: 'Juizados', topics: [3], refs: null },
    ];
    const r = fillArticleGaps(list, [{ law: 'CPC', topic: 0, ranges: [{ from: 233, to: 237 }] }, { law: 'L12153', topic: 2, ranges: [{ from: 1, to: 29 }] }],
      (k) => lawCite(k), { topicBase: 1, eligible: (_, i) => i !== 0 });
    expect(r.sessions[0]).toEqual(list[0]);
    expect(r.sessions[1]!.refs).toEqual([{ law: 'CPC', ranges: [{ from: 260, to: 275 }, { from: 233, to: 237 }] }]);
    expect(r.sessions[2]!.refs).toEqual([{ law: 'L12153', ranges: [{ from: 1, to: 29 }] }]);
    expect(r.sessions[2]!.topics).toEqual([3]);
  });
});
