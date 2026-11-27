import { describe, expect, it } from 'vitest';
import { discardCount, hintSteps, isTrueFalse, type Hints } from './hints.ts';

const alts = (s: string) => s.split('').map((letra) => ({ letra }));
const h = (p: Partial<Hints>): Hints => ({ pista: 'Pense em quem pode rever o próprio ato.', foco: '', descartes: [], conceito: 'A Administração pode anular os próprios atos ilegais.', ...p });

describe('dicas em graus', () => {
  it('quantas alternativas o grau 2 descarta', () => {
    expect(discardCount(5)).toBe(2);
    expect(discardCount(4)).toBe(1);
    expect(discardCount(3)).toBe(1);
    expect(discardCount(2)).toBe(0);
  });

  it('múltipla: pista, descartes válidos (nunca o gabarito) e conceito', () => {
    const steps = hintSteps(h({ descartes: [{ letra: 'B', motivo: 'Gabarito é B' }, { letra: 'A)', motivo: 'Prazo errado.' }, { letra: 'A', motivo: 'repetida' }, { letra: 'Z', motivo: 'não existe' }, { letra: 'D', motivo: 'Troca a competência.' }, { letra: 'E', motivo: 'Sobrou.' }] }), { gabarito: 'B', alternativas: alts('ABCDE') });
    expect(steps.map((s) => s.kind)).toEqual(['pista', 'descarte', 'conceito']);
    expect(steps[1]).toEqual({ kind: 'descarte', itens: [{ letra: 'A', motivo: 'Prazo errado.' }, { letra: 'D', motivo: 'Troca a competência.' }] });
  });

  it('certo ou errado: foco no lugar do descarte', () => {
    expect(isTrueFalse([])).toBe(true);
    expect(isTrueFalse(alts('CE'))).toBe(true);
    const steps = hintSteps(h({ foco: 'Repare em quem conta o prazo.', descartes: [{ letra: 'E', motivo: 'x' }] }), { gabarito: 'C', alternativas: [] });
    expect(steps.map((s) => s.kind)).toEqual(['pista', 'foco', 'conceito']);
  });

  it('grau que entrega a resposta sai e os seguintes sobem', () => {
    const steps = hintSteps(h({ pista: 'A alternativa C traz a regra.', foco: 'O item está errado por causa do prazo.', conceito: 'O gabarito segue o art. 54.' }), { gabarito: 'E', alternativas: alts('CE') });
    expect(steps).toEqual([]);
    const two = hintSteps(h({ pista: 'Letra "D" é a resposta.' }), { gabarito: 'D', alternativas: alts('ABCD') });
    expect(two.map((s) => s.kind)).toEqual(['conceito']);
  });
});
