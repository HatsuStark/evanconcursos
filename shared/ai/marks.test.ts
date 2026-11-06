import { describe, expect, it } from 'vitest';
import { marksToHtml, missingMark, splitMarks } from './marks.ts';

describe('destaque no enunciado', () => {
  const q = 'O morador mantinha uma postura **beligerante** diante da ordem. Um antônimo para a palavra destacada é:';

  it('separa o trecho marcado para o negrito', () => {
    expect(splitMarks(q)).toEqual([
      { text: 'O morador mantinha uma postura ', bold: false },
      { text: 'beligerante', bold: true },
      { text: ' diante da ordem. Um antônimo para a palavra destacada é:', bold: false },
    ]);
    expect(splitMarks('sem marca')).toEqual([{ text: 'sem marca', bold: false }]);
  });

  it('vira HTML escapado, só a marca em negrito', () => {
    expect(marksToHtml('a < b e **c & d**')).toBe('a &lt; b e <b>c &amp; d</b>');
  });

  it('acusa comando que fala em destaque sem nada marcado', () => {
    expect(missingMark(q)).toBe(false);
    expect(missingMark('Um antônimo para a palavra destacada é:')).toBe(true);
    expect(missingMark('O termo <b>beligerante</b>, em destaque, significa:')).toBe(false);
    expect(missingMark('Assinale a alternativa correta.')).toBe(false);
  });
});
