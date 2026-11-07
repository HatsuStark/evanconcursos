import { describe, expect, it } from 'vitest';
import { hotArticleKeys, hotGuideNote, hotPrompt } from './hot.ts';

describe('mais cobrados (IA)', () => {
  const arts = [{ lawKey: 'lei-13105-2015', label: '238' }, { lawKey: 'lei-13105-2015', label: '1.015' }];
  const short = () => 'CPC';

  it('aceita só artigos que existem entre os fornecidos, em formatos variados', () => {
    const keys = hotArticleKeys({ temas: [], artigos: ['CPC art 238', 'CPC, artigo 1.015º', 'CPC, art. 999', 'CP, art. 238'] }, arts, short);
    expect(keys).toEqual(['lei-13105-2015:238', 'lei-13105-2015:1.015']);
  });

  it('a nota da apostila avisa que é estimativa e pede a lei completa; sem resultado, nada', () => {
    expect(hotGuideNote({ temas: ['Citação por edital'], artigos: [] })).toMatch(/estimativa.*lei seca completa/);
    expect(hotGuideNote(null)).toBe('');
    expect(hotGuideNote({ temas: [], artigos: [] })).toBe('');
  });

  it('o prompt leva só os nomes das seções, sem texto de lei', () => {
    const p = hotPrompt({ banca: 'FGV', subject: 'Processo Civil', title: 'Citação', topics: [], laws: [{ ref: 'CPC, arts. 238 a 259', short: 'CPC', sections: [{ name: 'Da Citação', from: '238', to: '259' }] }] });
    expect(p).toContain('Da Citação (arts. 238 a 259)');
    expect(p).toContain('FGV');
  });
});
