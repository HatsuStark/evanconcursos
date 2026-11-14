import { describe, expect, it } from 'vitest';
import { citesUnknownPrecedent, generatedPrompt, generatedRoom, type GenJuris } from './generated.ts';

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

describe('jurisprudência como fonte das inéditas', () => {
  const juris: GenJuris[] = [{ ref: 'Súmula 17/STJ', text: 'Quando o falso se exaure no estelionato, sem mais potencialidade lesiva, é por este absorvido.', court: 'STJ', kind: 'sumula', number: 17 }];
  const base = { banca: 'FGV', cargo: 'Analista', subject: 'Direito Penal', title: 'Estelionato (CP, art. 171)', keyword: 'estelionato', law: [{ ref: 'CP, art. 171', text: 'Obter, para si ou para outrem, vantagem ilícita…' }], format: 'multipla escolha', n: 3, avoid: [] };
  const q = (enunciado: string) => ({ enunciado, alternativas: ['a', 'b', 'c', 'd', 'e'], fundamento: '' });

  it('com súmulas fornecidas, o prompt as traz e permite citá-las; sem elas, proíbe', () => {
    const withJuris = generatedPrompt({ ...base, juris });
    expect(withJuris).toContain('[Súmula 17/STJ]');
    expect(withJuris).not.toContain('Não cite jurisprudência, súmulas ou doutrina.');
    expect(generatedPrompt(base)).toContain('Não cite jurisprudência, súmulas ou doutrina.');
  });

  it('questão que cita súmula fora das fornecidas é descartada', () => {
    expect(citesUnknownPrecedent(q('De acordo com a Súmula 17 do STJ, o falso é absorvido pelo estelionato quando…'), juris)).toBe(false);
    expect(citesUnknownPrecedent(q('De acordo com a Súmula 48 do STJ, compete ao juízo…'), juris)).toBe(true);
    expect(citesUnknownPrecedent(q('De acordo com a Súmula 17 do STJ, …'), [])).toBe(true);
    expect(citesUnknownPrecedent(q('Nessa situação, de acordo com o Código Penal, …'), [])).toBe(false);
  });
});
