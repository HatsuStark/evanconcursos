import { describe, expect, it } from 'vitest';
import { mayHaveMnemonic } from './mnemonic.ts';

const q = (enunciado: string, materia: string, alts: string[] = ['a', 'b'], mnemo?: 'yes' | 'no' | 'maybe') => ({ enunciado, materia, assunto: '', alternativas: alts.map((texto) => ({ texto })), mnemo });

describe('quando mostrar a aba Mnemônico', () => {
  it('mostra em listas, requisitos, prazos e artigos de lei', () => {
    expect(mayHaveMnemonic(q('São requisitos do ato administrativo:', 'Direito Administrativo'))).toBe(true);
    expect(mayHaveMnemonic(q('No caso de morte do ofendido, o direito de intervir como assistente passará a:', 'Direito Processual Penal', ['ao cônjuge, ascendente, descendente ou irmão', 'apenas ao cônjuge']))).toBe(true); // lista nas alternativas
    expect(mayHaveMnemonic(q('Nos termos do art. 268 do CPP, o assistente pode intervir…', 'Direito Processual Penal'))).toBe(true);
    expect(mayHaveMnemonic(q('O prazo para interposição de apelação é de:', 'Direito Processual Civil - CPC 2015', ['5 dias', '15 dias']))).toBe(true);
  });
  it('esconde em interpretação, português, matemática e raciocínio', () => {
    expect(mayHaveMnemonic(q('De acordo com o texto, o autor defende que', 'Direito Constitucional'))).toBe(false);
    expect(mayHaveMnemonic(q('Assinale a alternativa em que a crase está correta', 'Língua Portuguesa'))).toBe(false);
    expect(mayHaveMnemonic(q('Calcule a porcentagem de aumento', 'Matemática'))).toBe(false);
    expect(mayHaveMnemonic(q('Se todo A é B, então', 'Raciocínio Lógico'))).toBe(false);
  });
  it('o que a IA já decidiu prevalece', () => {
    expect(mayHaveMnemonic(q('Texto qualquer sem pistas', 'Direito Penal', ['a'], 'yes'))).toBe(true);
    expect(mayHaveMnemonic(q('São requisitos do ato:', 'Direito Administrativo', ['a'], 'no'))).toBe(false);
  });
});
