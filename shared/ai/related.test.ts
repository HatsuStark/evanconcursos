import { describe, expect, it } from 'vitest';
import { mergeRelated, outsideRefs, relatedPrompt, stillUnverified } from './related.ts';

const provided = [{ lawKey: 'L9099', label: '89', num: 89, suffix: '' }];

describe('outsideRefs', () => {
  it('pega os artigos citados fora dos trechos, com a frase que os cita', () => {
    const text = 'A suspensão condicional do processo segue o art. 89 da Lei 9.099/95. Os requisitos vêm do art. 77 do CP, aplicados por remissão. Não confunda com o art. 44 do CP.';
    const refs = outsideRefs(text, provided, 'Direito Penal');
    expect(refs.map((r) => r.ref)).toEqual(['CP, art. 77', 'CP, art. 44']);
    expect(refs[0]!.context).toBe('Os requisitos vêm do art. 77 do CP, aplicados por remissão.');
    expect(refs[0]).toMatchObject({ lawKey: 'CP', num: 77, suffix: '' });
  });

  it('deixa de fora os fornecidos, os intervalos grandes e as repetições', () => {
    const text = 'O CP, art. 77, traz os requisitos. Veja ainda os arts. 1º a 30 do CP. De novo, o art. 77 do CP.';
    expect(outsideRefs(text, provided, 'Direito Penal').map((r) => r.ref)).toEqual(['CP, art. 77']);
  });

  it('artigo sem lei na frase fica com a lei citada antes no texto', () => {
    const text = 'Os Juizados seguem a Lei 9.099/95. O art. 89 trata da suspensão. Já o art. 77 do CP traz os requisitos.';
    expect(outsideRefs(text, provided, 'Direito Processual Civil').map((r) => r.ref)).toEqual(['CP, art. 77']);
  });

  it('respeita o máximo por apostila', () => {
    const text = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `Veja o art. ${n * 10} do CP.`).join(' ');
    expect(outsideRefs(text, [], 'Direito Penal', [], 3)).toHaveLength(3);
  });
});

describe('mergeRelated', () => {
  const items = [{ ref: 'CP, art. 77', text: 'Art. 77. A execução da pena...' }, { ref: 'CP, art. 44', text: 'Art. 44. As penas restritivas...' }];

  it('junta pelo colchete e zera a explicação do que não confere', () => {
    const r = mergeRelated(items, { itens: [
      { ref: 'CP, art. 44', confere: false, explicacao: 'qualquer coisa' },
      { ref: 'cp,  art. 77', confere: true, explicacao: ' Traz os requisitos do sursis. ' },
    ] });
    expect(r).toEqual([
      { ref: 'CP, art. 77', texto: items[0]!.text, explicacao: 'Traz os requisitos do sursis.', confere: true },
      { ref: 'CP, art. 44', texto: items[1]!.text, explicacao: '', confere: false },
    ]);
  });

  it('artigo sem veredito ou sem explicação fica como não conferido', () => {
    const r = mergeRelated(items, { itens: [{ ref: 'CP, art. 77', confere: true, explicacao: '  ' }] });
    expect(r.map((x) => x.confere)).toEqual([false, false]);
  });
});

describe('stillUnverified', () => {
  it('tira do aviso só os conferidos', () => {
    const related = [{ ref: 'CP, art. 77', texto: '', explicacao: 'x', confere: true }, { ref: 'CP, art. 44', texto: '', explicacao: '', confere: false }];
    expect(stillUnverified(['CP, art. 77', 'CP, art. 44', 'Súmula 9/STJ'], related)).toEqual(['CP, art. 44', 'Súmula 9/STJ']);
    expect(stillUnverified(['CP, art. 77'], null)).toEqual(['CP, art. 77']);
  });
});

it('relatedPrompt leva tema, frase e texto oficial de cada artigo', () => {
  const p = relatedPrompt({ subject: 'Direito Penal', title: 'Suspensão condicional do processo' }, [{ ref: 'CP, art. 77', context: 'Os requisitos vêm do art. 77 do CP.', text: 'Art. 77. A execução...' }]);
  expect(p).toContain('Tema da sessão: Suspensão condicional do processo');
  expect(p).toContain('[CP, art. 77]\nFrase da apostila: Os requisitos vêm do art. 77 do CP.\nTexto oficial: Art. 77. A execução...');
});
