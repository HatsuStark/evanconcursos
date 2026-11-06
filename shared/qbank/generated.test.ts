import { describe, expect, it } from 'vitest';
import { generatedRoom } from './generated.ts';

const api = (n: number) => Array.from({ length: n }, (_, i) => `q${i}`);
const ai = (n: number) => Array.from({ length: n }, (_, i) => `ia-${i}`);

describe('generatedRoom', () => {
  it('com o banco rendendo, no máximo 1 da IA para cada 3 da API', () => {
    expect(generatedRoom({ missing: 5, sessionQids: api(2), apiDry: false })).toBe(0);
    expect(generatedRoom({ missing: 5, sessionQids: api(3), apiDry: false })).toBe(1);
    expect(generatedRoom({ missing: 5, sessionQids: api(9), apiDry: false })).toBe(3);
    expect(generatedRoom({ missing: 2, sessionQids: api(9), apiDry: false })).toBe(2);
  });

  it('desconta as da IA já servidas na sessão', () => {
    expect(generatedRoom({ missing: 5, sessionQids: [...api(6), ...ai(2)], apiDry: false })).toBe(0);
    expect(generatedRoom({ missing: 5, sessionQids: [...api(5), ...ai(11)], apiDry: false })).toBe(0);
    expect(generatedRoom({ missing: 5, sessionQids: [...api(12), ...ai(2)], apiDry: false })).toBe(2);
  });

  it('banco esgotado ou sem questão real na sessão: a IA completa', () => {
    expect(generatedRoom({ missing: 4, sessionQids: [...api(3), ...ai(5)], apiDry: true })).toBe(4);
    expect(generatedRoom({ missing: 4, sessionQids: ai(3), apiDry: false })).toBe(4);
  });

  it('nada faltando, nada da IA', () => {
    expect(generatedRoom({ missing: 0, sessionQids: [], apiDry: true })).toBe(0);
  });
});
