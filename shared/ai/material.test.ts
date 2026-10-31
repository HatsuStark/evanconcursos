import { describe, expect, it } from 'vitest';
import { hasText, pageIndex, validateMap, validPages } from './material.ts';

describe('mapeamento de apostila', () => {
  it('aceita do navegador só uma lista de páginas de texto, com limites', () => {
    expect(validPages(['a', 'b'])).toEqual(['a', 'b']);
    expect(validPages(['x'.repeat(9000)])![0]).toHaveLength(6000);
    for (const bad of [undefined, 'texto', [], [1], Array(3001).fill('a')]) expect(validPages(bad)).toBeNull();
  });
  it('índice compacto por página, cabendo no limite mesmo com muitas páginas', () => {
    expect(pageIndex(['Capítulo 1   Inquérito\npolicial', 'Ação penal'])).toBe('p.1: Capítulo 1 Inquérito policial\np.2: Ação penal');
    const big = pageIndex(Array.from({ length: 1000 }, () => 'x'.repeat(1000)));
    expect(big.length).toBeLessThan(130_000);
  });
  const body = Array.from({ length: 12 }, (_, i) => `Linha ${i} de explicação comum sobre o funcionamento geral da administração pública estadual.`);
  it('assunto no meio da página aparece pelo título da sessão, mesmo sem acento igual', () => {
    const page = [...body, 'A estabilidade ocorre depois do estágio probatório, como explicado adiante neste capítulo da aula.', ...body].join('\n');
    const index = pageIndex([page], ['Estabilídade e Petição']);
    expect(index).toContain('A estabilidade ocorre');
    expect(index).toContain(' … ');
    expect(pageIndex([page])).not.toContain('A estabilidade ocorre');
  });
  it('títulos no meio da página entram; palavra presente em quase toda página não conta como assunto', () => {
    const pages = Array.from({ length: 8 }, () => [...body, '1.13 Outros direitos', ...body].join('\n'));
    pages[0] = [...body, 'Lista 1.13 Outros direitos', 'explicação do servidor sem título aqui, em linha comum e bem longa para não parecer um título.', ...body].join('\n');
    const index = pageIndex(pages, ['funcionamento']);
    expect(index).toContain('Lista 1.13 Outros direitos');
    expect(index.split('\n')[0]!.length).toBeLessThanOrEqual(610);
  });
  it('sumário vai inteiro', () => {
    const toc = Array.from({ length: 40 }, (_, i) => `Assunto número ${i} ............ ${i + 3}`).join('\n');
    expect(pageIndex([toc])).toContain('Assunto número 39');
  });
  it('detecta PDF escaneado (sem texto)', () => {
    expect(hasText(['', ' ', '\n', 'x'])).toBe(false);
    expect(hasText(['Texto suficiente para contar como página com conteúdo real.', '', 'Outra página com bastante texto aqui dentro.'])).toBe(true);
  });
  it('valida a resposta da IA: sessões conhecidas, páginas existentes, trecho limitado', () => {
    const v = validateMap({ mapa: [
      { sessao: 's1', inicio: 10, fim: 14 }, { sessao: 'S9', inicio: 1, fim: 2 },
      { sessao: 'S2', inicio: 0, fim: 999 }, { sessao: 'S3', inicio: 40, fim: 30 },
    ] }, new Set(['S1', 'S2', 'S3']), 200);
    expect(v).toEqual([{ code: 'S1', from: 10, to: 14 }, { code: 'S2', from: 1, to: 120 }, { code: 'S3', from: 40, to: 40 }]);
  });
  it('sessão pode ter até 3 trechos, sem sobreposição', () => {
    const v = validateMap({ mapa: [
      { sessao: 'S1', inicio: 56, fim: 56 }, { sessao: 'S1', inicio: 117, fim: 118 }, { sessao: 'S1', inicio: 118, fim: 120 },
      { sessao: 'S1', inicio: 130, fim: 131 }, { sessao: 'S1', inicio: 140, fim: 141 },
    ] }, new Set(['S1']), 200);
    expect(v).toEqual([{ code: 'S1', from: 56, to: 56 }, { code: 'S1', from: 117, to: 118 }, { code: 'S1', from: 130, to: 131 }]);
  });
});
