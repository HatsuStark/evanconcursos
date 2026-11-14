import { describe, expect, it } from 'vitest';
import { citesUnknownPrecedent, coveredLine, dropRepeated, sameAnswer, generatedPrompt, generatedRoom, type GenJuris } from './generated.ts';

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

  it('banco esgotado no tema: a IA completa', () => {
    expect(generatedRoom({ missing: 4, sessionQids: [...api(3), ...ai(5)], apiDry: true })).toBe(4);
  });

  it('começo da sessão ou pedido sem questão nova, com o banco rendendo: a proporção vale; sem nada para mostrar, só 1', () => {
    expect(generatedRoom({ missing: 4, sessionQids: [], apiDry: false })).toBe(0);
    expect(generatedRoom({ missing: 4, sessionQids: ai(3), apiDry: false })).toBe(0);
    expect(generatedRoom({ missing: 4, sessionQids: ai(3), apiDry: false, empty: true })).toBe(1);
    expect(generatedRoom({ missing: 5, sessionQids: api(9), apiDry: false, empty: true })).toBe(3);
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

describe('variedade das inéditas', () => {
  const right = 'suspende a prescrição, para todos os efeitos de direito, por 180 dias, ou até a distribuição da execução fiscal, se esta ocorrer antes de findo aquele prazo.';
  const reworded = 'suspende a prescrição por cento e oitenta dias, ou até a distribuição da execução fiscal, se esta ocorrer antes de findo aquele prazo.';
  const other = 'abrange atualização monetária, juros e multa de mora e demais encargos previstos em lei ou contrato.';
  const mk = (correct: string, gabarito = 'B') => ({ enunciado: 'Um Oficial de Justiça cumpre mandado em execução fiscal. Nos termos da Lei nº 6.830/1980, a inscrição em dívida ativa', alternativas: ['interrompe a prescrição.', correct, 'x', 'y', 'z'], gabarito });

  it('a mesma resposta certa com outras palavras é repetição; resposta curta ou de outro ponto, não', () => {
    expect(sameAnswer(right, reworded)).toBe(true);
    expect(sameAnswer(right, other)).toBe(false);
    expect(sameAnswer('30 dias', '30 dias')).toBe(false);
  });

  it('descarta do lote a questão que repete uma já criada ou outra do lote', () => {
    expect(dropRepeated([mk(reworded), mk(other)], [right]).map((q) => q.alternativas[1])).toEqual([other]);
    expect(dropRepeated([mk(right), mk(reworded), mk(other)], [])).toHaveLength(2);
  });

  it('a lista de já criadas leva o comando e a resposta certa, não só a moldura do caso', () => {
    const line = coveredLine(mk(right).enunciado, mk(right).alternativas, 'B');
    expect(line).toContain('a inscrição em dívida ativa → suspende a prescrição');
    expect(coveredLine('A inscrição em dívida ativa suspende a prescrição por 180 dias.', [], 'C')).toBe('A inscrição em dívida ativa suspende a prescrição por 180 dias.');
  });
});
