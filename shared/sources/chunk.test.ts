import { describe, expect, it } from 'vitest';
import { chunkPages, fixLatexAccents, HEADING_MARK, markHeadings, pageLines, runningLines } from './chunk.ts';

// Uma frase por linha, como nos PDFs; o assunto varia para as linhas não parecerem cabeçalho repetido.
const WORDS = ['memória', 'paginação', 'processos', 'arquivos', 'segurança', 'redes', 'threads', 'discos'];
const para = (n: number, k = 0) => Array.from({ length: n }, (_, i) => `Frase sobre ${WORDS[(i + k) % WORDS.length]} e ${WORDS[(i * 3 + k + 1) % WORDS.length]} no sistema.`).join('\n');

describe('acentos do LaTeX', () => {
  it('junta acento e letra, com ou sem o espaço falso', () => {
    expect(fixLatexAccents('Seguranc¸a para Internet: leil˜ao, transac¸ ˜oes, ´e, ˆe, ´ı')).toBe('Segurança para Internet: leilão, transações, é, ê, í');
    expect(fixLatexAccents('ATRIBUIC¸ ˜AO USO N ˜AO COMERCIAL, VOC ˆE')).toBe('ATRIBUIÇÃO USO NÃO COMERCIAL, VOCÊ');
    expect(fixLatexAccents('a ação ´e aquele')).toBe('a ação é aquele');
  });
});

describe('títulos pela fonte', () => {
  it('marca linhas de fonte maior que a do corpo', () => {
    const body = (t: string) => ({ text: t, height: 10 });
    const pages = [[{ text: 'Capítulo 3', height: 16 }, body(para(3)), body(para(3)), { text: '12', height: 16 }]];
    expect(markHeadings(pages)[0]).toBe([`${HEADING_MARK}Capítulo 3`, para(3), para(3), '12'].join('\n'));
  });

  it('linhas do pdf.js com a maior altura da linha', () => {
    expect(pageLines([{ str: 'Olá ', height: 10 }, { str: 'mundo', height: 12, hasEOL: true }, { str: 'fim', height: 9 }]))
      .toEqual([{ text: 'Olá mundo', height: 12 }, { text: 'fim', height: 9 }]);
  });
});

describe('trechos', () => {
  const page = (n: number, body: string, head = `Sistemas Operacionais cap. 2 – pg. ${n}`) => `${head}\n${body}\n${n}`;

  it('tira cabeçalho repetido, número de página e legenda; guarda seção e páginas', () => {
    const pages = [
      page(1, `${HEADING_MARK}14.4 A memória virtual\n${para(20)}\nFigura 3: esquema da paginação`),
      page(2, para(20, 2)),
      page(3, `14.5 Paginação\n${para(10, 4)}`),
      page(4, para(4, 6)),
    ];
    const ch = chunkPages(pages);
    expect(ch.every((c) => !/Sistemas Operacionais cap|Figura 3/.test(c.text))).toBe(true);
    expect(ch[0]).toMatchObject({ heading: '14.4 A memória virtual', pageFrom: 1 });
    expect(ch.at(-1)).toMatchObject({ heading: '14.5 Paginação', pageTo: 4 });
    expect(ch.every((c) => c.text.length <= 1400 + 120)).toBe(true);
  });

  it('emenda palavra hifenizada no fim da linha', () => {
    const [c] = chunkPages([`${para(5)} subcon-\njuntos dos reais e mais texto. ${para(3)}`]);
    expect(c!.text).toContain('subconjuntos dos reais');
  });

  it('pula sumário e cabeçalho com página ("Capítulo | 15")', () => {
    const toc = Array.from({ length: 10 }, (_, i) => `${i + 1}.1 Seção qualquer ........ ${i * 3 + 5}`).join('\n');
    const ch = chunkPages([toc, `Configurar o LibreOffice | 15\n${para(10)}`]);
    expect(ch).toHaveLength(1);
    expect(ch[0]!.text).not.toContain('Seção qualquer');
    expect(ch[0]!.text).not.toContain('| 15');
  });

  it('item de lista numerado não vira título', () => {
    const [c] = chunkPages([`${para(4)}\n8 Mover para cima com o botão\n${para(4)}`]);
    expect(c!.heading).toBe('');
  });

  it('cabeçalhos repetidos com o número da página', () => {
    expect(runningLines([['14 Cartilha', 'a'], ['15 Cartilha', 'b'], ['16 Cartilha', 'c']])).toEqual(new Set(['# Cartilha']));
  });
});
