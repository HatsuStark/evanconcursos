import { describe, expect, it } from 'vitest';
import { mayHaveMnemonic } from './mnemonic.ts';

const q = (enunciado: string, materia: string, alts: string[] = ['a', 'b'], mnemo?: 'yes' | 'no' | 'maybe', assunto = '') =>
  ({ enunciado, materia, assunto, alternativas: alts.map((texto) => ({ texto })), mnemo });

describe('quando mostrar a aba Mnemônico', () => {
  it('Direito: requisitos, prazos, artigos e listas nas alternativas', () => {
    expect(mayHaveMnemonic(q('São requisitos do ato administrativo:', 'Direito Administrativo'))).toBe(true);
    expect(mayHaveMnemonic(q('No caso de morte do ofendido, o direito de intervir como assistente passará a:', 'Direito Processual Penal', ['ao cônjuge, ascendente, descendente ou irmão', 'apenas ao cônjuge']))).toBe(true);
    expect(mayHaveMnemonic(q('Nos termos do art. 268 do CPP, o assistente pode intervir…', 'Direito Processual Penal'))).toBe(true);
  });
  it('Português, Matemática, Raciocínio e Informática também têm mnemônicos', () => {
    expect(mayHaveMnemonic(q('Assinale a alternativa em que o acento indicativo de crase está correto', 'Língua Portuguesa'))).toBe(true);
    expect(mayHaveMnemonic(q('Assinale o emprego correto dos porquês', 'Língua Portuguesa'))).toBe(true);
    expect(mayHaveMnemonic(q('Um capital aplicado a juros simples rende…', 'Matemática'))).toBe(true);
    expect(mayHaveMnemonic(q('A negação de "Se chove, então a rua molha" é', 'Raciocínio Lógico'))).toBe(true);
    expect(mayHaveMnemonic(q('O atalho de teclado Ctrl + Z no Word serve para', 'Informática'))).toBe(true);
  });
  it('esconde interpretação de texto (em qualquer matéria)', () => {
    expect(mayHaveMnemonic(q('De acordo com o texto, o autor defende que', 'Língua Portuguesa'))).toBe(false);
    expect(mayHaveMnemonic(q('Infere-se do trecho que a decisão do tribunal', 'Direito Constitucional'))).toBe(false);
    expect(mayHaveMnemonic(q('Qual é a ideia central?', 'Língua Portuguesa', ['a', 'b'], undefined, 'Interpretação de Textos'))).toBe(false);
  });
  it('o que a IA já decidiu prevalece', () => {
    expect(mayHaveMnemonic(q('Texto qualquer sem pistas', 'Direito Penal', ['a'], 'yes'))).toBe(true);
    expect(mayHaveMnemonic(q('São requisitos do ato:', 'Direito Administrativo', ['a'], 'no'))).toBe(false);
  });
});
