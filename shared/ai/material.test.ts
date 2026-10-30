import { describe, expect, it } from 'vitest';
import { hasText, pageIndex, validateMap } from './material.ts';

describe('mapeamento de apostila', () => {
  it('índice compacto por página, cabendo no limite mesmo com muitas páginas', () => {
    expect(pageIndex(['Capítulo 1   Inquérito\npolicial', 'Ação penal'])).toBe('p.1: Capítulo 1 Inquérito policial\np.2: Ação penal');
    const big = pageIndex(Array.from({ length: 1000 }, () => 'x'.repeat(1000)));
    expect(big.length).toBeLessThan(200_000);
  });
  it('detecta PDF escaneado (sem texto)', () => {
    expect(hasText(['', ' ', '\n', 'x'])).toBe(false);
    expect(hasText(['Texto suficiente para contar como página com conteúdo real.', '', 'Outra página com bastante texto aqui dentro.'])).toBe(true);
  });
  it('valida a resposta da IA: sessões conhecidas, páginas existentes, sem duplicar, trecho limitado', () => {
    const v = validateMap({ mapa: [
      { sessao: 's1', inicio: 10, fim: 14 }, { sessao: 'S1', inicio: 50, fim: 60 }, { sessao: 'S9', inicio: 1, fim: 2 },
      { sessao: 'S2', inicio: 0, fim: 999 }, { sessao: 'S3', inicio: 40, fim: 30 },
    ] }, new Set(['S1', 'S2', 'S3']), 200);
    expect(v).toEqual([{ code: 'S1', from: 10, to: 14 }, { code: 'S2', from: 1, to: 120 }, { code: 'S3', from: 40, to: 40 }]);
  });
});
