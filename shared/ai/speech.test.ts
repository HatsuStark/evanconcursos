import { describe, expect, it } from 'vitest';
import { guideSpeech, speechChunks, spoken } from './speech.ts';

describe('leitura em voz alta', () => {
  it('fala abreviações e siglas por extenso', () => {
    expect(spoken('Nos termos do art. 5º, § 1º, da CF/88 c/c arts. 312 do CP')).toBe('Nos termos do artigo 5º, parágrafo 1º, da Constituição Federal combinado com artigos 312 do Código Penal');
    expect(spoken('CPP e CPC, **lei** nº 8.112')).toBe('Código de Processo Penal e Código de Processo Civil, lei número 8.112');
  });
  it('não confunde palavras comuns com abreviações', () => {
    expect(spoken('A arte e o partido, cc minúsculo')).toBe('A arte e o partido, cc minúsculo');
  });
  it('corta em trechos curtos sem perder texto', () => {
    const long = Array.from({ length: 30 }, (_, i) => `Frase número ${i} sobre o tema, com detalhes.`).join(' ');
    const chunks = speechChunks(long);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 220)).toBe(true);
    expect(chunks.join(' ')).toBe(long);
  });
  it('corta frase enorme sem pontuação', () => {
    const huge = 'palavra '.repeat(100).trim();
    const chunks = speechChunks(huge);
    expect(chunks.every((c) => c.length <= 220)).toBe(true);
    expect(chunks.join(' ')).toBe(huge);
  });
  it('corta texto sem nenhum espaço', () => {
    const chunks = speechChunks('x'.repeat(500));
    expect(chunks.every((c) => c.length <= 220)).toBe(true);
    expect(chunks.join('')).toBe('x'.repeat(500));
  });
  it('não separa número com ponto', () => {
    expect(speechChunks('A Lei 8.112 é federal.')).toEqual(['A Lei 8.112 é federal.']);
  });
  it('monta as seções na ordem da tela e omite as vazias', () => {
    const s = guideSpeech({
      titulo: 'Peculato', introducao: 'Intro.', secoes: [{ titulo: 'Conceito', texto: 'Texto.', exemplos: ['Caso.'] }],
      legislacao: [], pontos_banca: ['Cai.'], pegadinhas: [], resumo: [], perguntas: [{ pergunta: 'O quê?', resposta: 'Isso.' }],
    });
    expect(s.map((x) => x.key)).toEqual(['intro', 's0', 'banca', 'perguntas']);
    expect(s[1]!.chunks.join(' ')).toBe('Conceito Texto. Exemplo: Caso.');
    expect(s[3]!.chunks.join(' ')).toContain('Pergunta 1: O quê? Resposta: Isso.');
  });
});
