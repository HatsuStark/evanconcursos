import { describe, expect, it } from 'vitest';
import { dropHotDisclaimer, hotArticleKeys, hotGuideNote, hotPrompt } from './hot.ts';

describe('mais cobrados (IA)', () => {
  const arts = [{ lawKey: 'lei-13105-2015', label: '238' }, { lawKey: 'lei-13105-2015', label: '1.015' }];
  const short = () => 'CPC';

  it('aceita só artigos que existem entre os fornecidos, em formatos variados', () => {
    const keys = hotArticleKeys({ temas: [], artigos: ['CPC art 238', 'CPC, artigo 1.015º', 'CPC, art. 999', 'CP, art. 238'] }, arts, short);
    expect(keys).toEqual(['lei-13105-2015:238', 'lei-13105-2015:1.015']);
  });

  it('a nota da apostila não pede aviso no texto nem leitura da lei; sem resultado, nada', () => {
    const note = hotGuideNote({ temas: ['Citação por edital'], artigos: [] });
    expect(note).toContain('Citação por edital');
    expect(note).not.toMatch(/lei seca|Na introdução/);
    expect(hotGuideNote(null)).toBe('');
    expect(hotGuideNote({ temas: [], artigos: [] })).toBe('');
  });

  it('tira da introdução antiga a frase de estimativa e lei seca, e mantém o resto', () => {
    expect(dropHotDisclaimer('A citação chama o réu. Os destaques de banca são uma estimativa feita por IA, por isso, leia a lei seca completa antes de confiar nessas prioridades. Vamos ao tema.'))
      .toBe('A citação chama o réu. Vamos ao tema.');
    expect(dropHotDisclaimer('Leia a lei seca completa: os destaques são estimativa.')).toBe('');
    expect(dropHotDisclaimer('A lei seca define o prazo. Sem aviso aqui.')).toBe('A lei seca define o prazo. Sem aviso aqui.');
  });

  it('o prompt leva só os nomes das seções, sem texto de lei', () => {
    const p = hotPrompt({ banca: 'FGV', subject: 'Processo Civil', title: 'Citação', topics: [], laws: [{ ref: 'CPC, arts. 238 a 259', short: 'CPC', sections: [{ name: 'Da Citação', from: '238', to: '259' }] }] });
    expect(p).toContain('Da Citação (arts. 238 a 259)');
    expect(p).toContain('FGV');
  });
});
