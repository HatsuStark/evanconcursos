import { describe, expect, it } from 'vitest';
import { bookMatches, chunkRef, MAX_SOURCE_PICKS, mergeSourcePicks, sourcesQuery, type SourceCandidate } from './sources.ts';

const c = (id: string, page = 10): SourceCandidate => ({ id, source_key: 'maziero-so', page_from: page, page_to: page, heading: 'Memória virtual', text: `Texto ${id}`, rank: 1 });
const titleOf = () => 'Sistemas Operacionais';

describe('fontes da sessão', () => {
  it('busca com as palavras do tema, sem palavras genéricas, parênteses e números', () => {
    expect(sourcesQuery('Noções de sistemas operacionais: memória virtual e paginação (arts. 1 a 5)', 'escalonamento'))
      .toBe('escalonamento or sistemas or operacionais or memória or virtual or paginação');
  });

  it('referência com página ou intervalo', () => {
    expect(chunkRef('Guia do Writer 7.1', { page_from: 45, page_to: 45 })).toBe('Guia do Writer 7.1, p. 45');
    expect(chunkRef('Guia do Writer 7.1', { page_from: 45, page_to: 46 })).toBe('Guia do Writer 7.1, pp. 45-46');
    expect(chunkRef('Guia Foca Linux', { page_from: 3, page_to: 4, href: 'https://x/p3', heading: 'Permissões' })).toBe('Guia Foca Linux, seção “Permissões”');
    expect(chunkRef('Guia Foca Linux', { page_from: 3, page_to: 3, href: 'https://x/p3', heading: '' })).toBe('Guia Foca Linux');
  });

  it('escolhidos na ordem da IA, sem repetidos nem inexistentes, até o limite', () => {
    const list = Array.from({ length: 8 }, (_, i) => c(`c${i}`, i + 1));
    const out = mergeSourcePicks(list, { itens: [{ n: 3, explica: ' Define memória virtual. ' }, { n: 3, explica: 'x' }, { n: 99, explica: 'x' }, ...[0, 1, 2, 4].map((n) => ({ n, explica: 'y' }))] }, titleOf);
    expect(out.map((x) => x.id)).toEqual(['c3', 'c0', 'c1', 'c2'].slice(0, MAX_SOURCE_PICKS));
    expect(out[0]).toMatchObject({ why: 'Define memória virtual.', ref: 'Sistemas Operacionais, p. 4' });
  });

  it('sem escolha da IA: os primeiros da busca, sem frase; lista vazia da IA: nada', () => {
    expect(mergeSourcePicks([c('a'), c('b')], null, titleOf).map((x) => [x.id, x.why])).toEqual([['a', ''], ['b', '']]);
    expect(mergeSourcePicks([c('a')], { itens: [] }, titleOf)).toEqual([]);
  });

  it('livro sugerido só vale se autor e título conferem no Google Books', () => {
    expect(bookMatches({ titulo: 'Engenharia de Software', autor: 'Sommerville' }, { title: 'Engenharia de software', authors: ['Ian Sommerville'] })).toBe(true);
    expect(bookMatches({ titulo: 'Engenharia de Software', autor: 'Sommerville' }, { title: 'Engenharia de software', authors: ['Roger S. Pressman'] })).toBe(false);
    expect(bookMatches({ titulo: 'Sistemas Operacionais Modernos', autor: 'Tanenbaum' }, { title: 'Redes de computadores', authors: ['Andrew S. Tanenbaum'] })).toBe(false);
  });
});
