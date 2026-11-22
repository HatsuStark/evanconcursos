import { describe, expect, it } from 'vitest';
import { cleanTrueFalse, trueFalsePrompt } from './true-false.ts';

const it6 = (certo: boolean, afirmacao: string, explicacao = 'Porque a lei diz assim.') => ({ afirmacao, certo, explicacao });

describe('cleanTrueFalse', () => {
  it('tira vazias, perguntas, repetidas e prefixos', () => {
    const r = cleanTrueFalse([
      it6(true, 'Julgue o item: O prazo é de 15 dias.', 'Certo. O prazo é de 15 dias.'),
      it6(true, 'O prazo é de 15 dias'),
      it6(false, 'O prazo é de 30 dias.'),
      it6(false, 'Qual é o prazo?'),
      it6(true, '', 'x'),
      it6(false, 'A competência é do juiz.', 'errado: é do delegado.'),
    ]);
    expect(r.map((x) => x.afirmacao)).toEqual(['O prazo é de 15 dias.', 'O prazo é de 30 dias.', 'A competência é do juiz.']);
    expect(r[0]!.explicacao).toBe('O prazo é de 15 dias.');
    expect(r[2]!.explicacao).toBe('É do delegado.');
  });
  it('sem certa e errada, ou com menos de 3, não serve', () => {
    expect(cleanTrueFalse([it6(true, 'a1'), it6(true, 'b2'), it6(true, 'c3')])).toEqual([]);
    expect(cleanTrueFalse([it6(true, 'a1'), it6(false, 'b2')])).toEqual([]);
  });
  it('no máximo 6', () => {
    expect(cleanTrueFalse(Array.from({ length: 9 }, (_, i) => it6(i % 2 === 0, `item número ${i}`)))).toHaveLength(6);
  });
});

describe('trueFalsePrompt', () => {
  it('traz só as partes preenchidas da revisão', () => {
    const p = trueFalsePrompt({ subject: 'Penal', title: 'Peculato', banca: 'VUNESP' }, { pegadinhas: ['Peculato culposo admite reparação'], memorizar: [] });
    expect(p).toContain('Pegadinhas');
    expect(p).toContain('banca VUNESP');
    expect(p).not.toContain('Para memorizar:');
  });
});
