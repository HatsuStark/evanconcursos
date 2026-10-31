import { describe, expect, it } from 'vitest';
import { mergeRects, readingMinutes, tooLongForSession } from './pdf-reading.ts';

describe('leitura de apostila', () => {
  it('estima o tempo de leitura e avisa só quando não cabe na sessão', () => {
    expect(readingMinutes(29)).toBe(44);
    expect(tooLongForSession(29, 30)).toBe(true);
    expect(tooLongForSession(14, 30)).toBe(false);
    expect(tooLongForSession(29, 0)).toBe(false);
  });
  it('junta pedaços da mesma linha e mantém linhas separadas', () => {
    expect(mergeRects([[0.3, 0.1, 0.2, 0.02], [0.1, 0.1, 0.21, 0.02], [0.1, 0.2, 0.5, 0.02]])).toEqual([[0.1, 0.1, 0.4, 0.02], [0.1, 0.2, 0.5, 0.02]]);
  });
  it('não junta pedaços distantes na mesma linha', () => {
    expect(mergeRects([[0.1, 0.1, 0.1, 0.02], [0.6, 0.1, 0.1, 0.02]])).toHaveLength(2);
  });
});
