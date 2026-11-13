import { describe, expect, it } from 'vitest';
import { mergeRelated, outsideRefs, planNotes, relatedPrompt, stillUnverified, type RelatedArticle } from './related.ts';

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
    const r = mergeRelated([{ ...items[0]!, context: 'Os requisitos vêm do art. 77 do CP.' }, items[1]!], { itens: [
      { ref: 'CP, art. 44', confere: false, explicacao: 'qualquer coisa', resumo: 'algo' },
      { ref: 'cp,  art. 77', confere: true, explicacao: ' Traz os requisitos do sursis. ', resumo: ' pena de até 2 anos; réu não reincidente. ' },
    ] });
    expect(r).toEqual([
      { ref: 'CP, art. 77', texto: items[0]!.text, explicacao: 'Traz os requisitos do sursis.', confere: true, resumo: 'pena de até 2 anos; réu não reincidente', trecho: 'Os requisitos vêm do art. 77 do CP.' },
      { ref: 'CP, art. 44', texto: items[1]!.text, explicacao: '', confere: false, resumo: '', trecho: '' },
    ]);
  });

  it('artigo sem veredito ou sem explicação fica como não conferido', () => {
    const r = mergeRelated(items, { itens: [{ ref: 'CP, art. 77', confere: true, explicacao: '  ', resumo: 'x' }] });
    expect(r.map((x) => x.confere)).toEqual([false, false]);
  });
});

describe('planNotes', () => {
  const rel = (ref: string, trecho: string, resumo = 'R'): RelatedArticle => ({ ref, trecho, resumo, texto: '', explicacao: 'x', confere: true });
  // Textos com os resumos inseridos entre parênteses.
  const insert = (texts: string[], related: RelatedArticle[]) => {
    const plan = planNotes(texts, related);
    return texts.map((t, i) => {
      let out = t;
      for (const p of [...(plan.get(i) ?? [])].reverse()) out = `${out.slice(0, p.at)} (${p.items.map((x) => x.resumo).join(' | ')})${out.slice(p.at)}`;
      return out;
    });
  };

  it('entra depois da citação, com incisos e lei', () => {
    const s = 'A regra não vale para a tutela da evidência dos incisos II e III do art. 311, incisos II e III, do CPC, nem para a decisão do art. 701.';
    expect(insert([s], [rel('CPC, art. 311', s, 'A'), rel('CPC, art. 701', s, 'B')]))
      .toEqual(['A regra não vale para a tutela da evidência dos incisos II e III do art. 311, incisos II e III, do CPC (A), nem para a decisão do art. 701 (B).']);
  });

  it('artigo numa lista ou num intervalo entra depois da lista', () => {
    const s = 'Veja os arts. 20 e 21 da LINDB sobre consequências.';
    expect(insert([s], [rel('LINDB, art. 21', s, 'B'), rel('LINDB, art. 20', s, 'A')])).toEqual(['Veja os arts. 20 e 21 da LINDB (B | A) sobre consequências.']);
    const t = 'Os arts. 20 a 23 tratam disso.';
    expect(insert([t], [rel('LINDB, art. 22', t)])).toEqual(['Os arts. 20 a 23 (R) tratam disso.']);
  });

  it('em todo texto que cita o artigo, uma vez por texto, só os conferidos com resumo', () => {
    const s = 'O art. 77 do CP traz os requisitos.', other = 'Antes, o art. 77 aparece de passagem; de novo o art. 77.';
    expect(insert([other, s], [rel('CP, art. 77', s)])).toEqual(['Antes, o art. 77 (R) aparece de passagem; de novo o art. 77.', 'O art. 77 do CP (R) traz os requisitos.']);
    const gp = 'O art. 77 do Código Penal traz os requisitos.';
    expect(insert([gp], [rel('CP, art. 77', gp)])).toEqual(['O art. 77 do Código Penal (R) traz os requisitos.']);
    expect(planNotes([s], [{ ...rel('CP, art. 77', s), confere: false }]).size).toBe(0);
    expect(planNotes([s], [rel('CP, art. 77', s, '')]).size).toBe(0);
  });

  it('trecho cortado antes da citação e outra lei escrita', () => {
    const s = 'Esse artigo tem exceções: a tutela da evidência e a decisão do art. 701.';
    const cut = 'O parágrafo único do art. 9º traz exceções longas';
    const texts = ['O art. 701 do CPP não é este.', `${cut} que só no fim citam o art. 701.`, s];
    expect(insert(texts, [rel('CPC, art. 701', cut)])).toEqual([texts[0], `${cut} que só no fim citam o art. 701 (R).`, 'Esse artigo tem exceções: a tutela da evidência e a decisão do art. 701 (R).']);
  });

  it('número que não é do artigo não engana', () => {
    const s = 'O prazo de 311 dias do art. 31 não se confunde.';
    expect(planNotes([s], [rel('CPC, art. 311', s)]).size).toBe(0);
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
