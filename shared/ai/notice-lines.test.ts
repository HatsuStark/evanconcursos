import { describe, expect, it } from 'vitest';
import type { NoticeExtraction } from './notice.ts';
import { adoptLineSubjects, numberLines, topicsFromLines } from './notice-lines.ts';

describe('trechos numerados do PDF', () => {
  it('emenda a continuação de linha e divide o parágrafo corrido antes de cada item', () => {
    const pages = ['NOÇÕES DE DIREITO PROCESSUAL PENAL:\n1 Processo penal brasileiro. Processo penal constitucional. 2 Sistemas e\nprincípios fundamentais. 3 Aplicação da lei processual no tempo, no espaço e em relação às\npessoas.'];
    expect(numberLines(pages).map((l) => l.text)).toEqual([
      'NOÇÕES DE DIREITO PROCESSUAL PENAL:',
      '1 Processo penal brasileiro. Processo penal constitucional.',
      '2 Sistemas e princípios fundamentais.',
      '3 Aplicação da lei processual no tempo, no espaço e em relação às pessoas.',
    ]);
  });

  it('não corta referência a artigos, tira cabeçalho repetido e número de página', () => {
    const page = (n: number) => `TRIBUNAL DE JUSTIÇA\nb) Do crime (arts. 13 a ${20 + n}).\n${n}`;
    const lines = numberLines([page(1), page(2), page(3), page(4)]);
    expect(lines.map((l) => l.text)).toEqual([21, 22, 23, 24].map((n) => `b) Do crime (arts. 13 a ${n}).`));
    expect(lines.map((l) => l.page)).toEqual([1, 2, 3, 4]);
  });

  it('mantém o hífen de palavra composta na quebra de linha', () => {
    expect(numberLines(['1.3 Organização político-\nadministrativa.'])[0]!.text).toBe('1.3 Organização político-administrativa.');
  });
});

describe('tópicos recortados pelas linhas apontadas', () => {
  const lines = numberLines(['DIREITO CIVIL\n1. Pessoas naturais.\n2. Bens.\nDIREITO PENAL\n1. Do crime.\n2. Das penas.']);
  it('cada tópico vai do início apontado até antes do próximo, sem o título solto', () => {
    const { spec, uncovered } = topicsFromLines(lines, { subjects: [
      { name: 'Direito Civil', starts: [2, 3], end: 4 },
      { name: 'Direito Penal', starts: [5, 6], end: 6 },
    ] });
    expect(spec.subjects.map((s) => s.topics.map((t) => t.text))).toEqual([['1. Pessoas naturais.', '2. Bens.'], ['1. Do crime.', '2. Das penas.']]);
    expect(uncovered).toEqual([]);
  });

  it('ignora linha apontada que não existe', () => {
    const { spec } = topicsFromLines(lines, { subjects: [{ name: 'Direito Civil', starts: [99], end: 4 }] });
    expect(spec.subjects[0]!.topics).toEqual([]);
  });
});

describe('disciplinas guarda-chuva', () => {
  const meta = { blocks: [{ name: 'BLOCO I: Conhecimentos Gerais', questions: 24, rule: '' }, { name: 'BLOCO II: Conhecimentos em Direito', questions: 30, rule: '' }], subjects: [
    { name: 'Língua Portuguesa', block: 'Bloco I', questions: 16, core: false, topics: [] },
    { name: 'Conhecimentos em Direito', block: '', questions: 30, core: true, topics: [] },
  ] } as unknown as NoticeExtraction;

  it('disciplina de verdade com seções internas recebe as seções como tópicos', () => {
    const juiz = { blocks: [{ name: 'Bloco III', questions: 35, rule: '' }], subjects: [
      { name: 'Noções Gerais de Direito e Formação Humanística', block: 'Bloco III', questions: 0, core: true, topics: [] },
    ] } as unknown as NoticeExtraction;
    const r = adoptLineSubjects(juiz, { subjects: [
      { name: 'SOCIOLOGIA DO DIREITO', topics: [{ text: '1. Noções gerais.', page: 69 }, { text: '2. Gestão.', page: 69 }] },
      { name: 'FILOSOFIA DO DIREITO', topics: [{ text: '1. O conceito de Justiça.', page: 70 }] },
    ] });
    expect(r.subjects).toHaveLength(1);
    expect(r.subjects[0]!.topics.map((t) => t.text)).toEqual(['SOCIOLOGIA DO DIREITO: 1. Noções gerais.', '2. Gestão.', 'FILOSOFIA DO DIREITO: 1. O conceito de Justiça.']);
  });
  it('dão lugar às disciplinas que as linhas acharam, no mesmo bloco', () => {
    const r = adoptLineSubjects(meta, { subjects: [
      { name: 'Língua Portuguesa', topics: [{ text: 'Crase.', page: 20 }] },
      { name: 'Direito Penal', topics: [{ text: 'Do crime.', page: 22 }] },
      { name: 'Direito Constitucional', topics: [{ text: 'Direitos fundamentais.', page: 22 }] },
    ] });
    expect(r.subjects.map((s) => [s.name, s.block, s.topics.length])).toEqual([
      ['Língua Portuguesa', 'Bloco I', 1], ['Direito Penal', 'Conhecimentos em Direito', 1], ['Direito Constitucional', 'Conhecimentos em Direito', 1],
    ]);
  });
});
