import { describe, expect, it } from 'vitest';
import { guideSpeech, lawLineSpoken, lawSpeech, romanToInt, speechChunks, speechParts, spoken } from './speech.ts';

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
    expect(s[1]!.chunks.join(' ')).toBe('Conceito. Texto. Exemplo: Caso.');
    expect(s[3]!.chunks.join(' ')).toContain('Pergunta 1: O quê? Resposta: Isso.');
  });
  it('agrupa os trechos em partes de até 1000 caracteres sem perder texto', () => {
    const text = Array.from({ length: 80 }, (_, i) => `Frase número ${i} sobre o tema, com detalhes.`).join(' ');
    const [s] = guideSpeech({ titulo: 'T', introducao: text, secoes: [], legislacao: [], pontos_banca: [], pegadinhas: [], resumo: [], perguntas: [] });
    const parts = speechParts(s!);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 1000)).toBe(true);
    expect(parts.join(' ')).toBe(s!.chunks.join(' '));
  });
});

describe('revisão curta falada', () => {
  const base = { titulo: 'T', introducao: 'I', legislacao: [], pontos_banca: [], pegadinhas: [], resumo: [], perguntas: [] };
  const esquema = [{ topico: 'Espécies', itens: ['apropriação', 'desvio'] }];
  it('lê mapa mental, mnemônicos e gatilhos na revisão (sem seções)', () => {
    const keys = guideSpeech({ ...base, secoes: [], esquema, mnemonicos: [{ alvo: 'Requisitos', mnemonico: 'ABC', explicacao: 'A de…' }], gatilhos: [{ pista: 'posse do bem', resposta: 'peculato' }] }).map((s) => s.key);
    expect(keys).toEqual(['intro', 'mapa', 'mnemonicos', 'gatilhos']);
  });
  it('na completa, o mapa não é lido (as seções explicam)', () => {
    const keys = guideSpeech({ ...base, secoes: [{ titulo: 'S', texto: 'x', exemplos: [] }], esquema }).map((s) => s.key);
    expect(keys).not.toContain('mapa');
  });
});

describe('lei seca em voz alta', () => {
  const art = (over: Partial<{ id: string; label: string; heading: string; text: string; revoked: boolean }>) =>
    ({ id: 'a1', label: '121', heading: 'Título I › Capítulo I - Dos Crimes contra a Vida', text: 'Art. 121. Matar alguém:', revoked: false, ...over });
  it('converte algarismos romanos', () => {
    expect(['I', 'IV', 'IX', 'XIV', 'XL', 'XC', 'LXXVIII'].map(romanToInt)).toEqual([1, 4, 9, 14, 40, 90, 78]);
  });
  it('fala inciso e alínea e tira notas de alteração', () => {
    expect(lawLineSpoken('IV - à traição (Redação dada pela Lei nº 13.964, de 2019)')).toBe('Inciso 4: à traição.');
    expect(lawLineSpoken('b) motivo fútil;')).toBe('Alínea b: motivo fútil;');
    expect(lawLineSpoken('(Incluído pela Lei nº 1.234)')).toBe('');
  });
  it('um artigo por seção, anunciando o capítulo só quando muda', () => {
    const s = lawSpeech([art({}), art({ id: 'a2', label: '122', text: 'Art. 122. Induzir alguém\nI - por motivo egoístico' })]);
    expect(s.map((x) => x.key)).toEqual(['a1', 'a2']);
    expect(s[0]!.chunks.join(' ')).toBe('Capítulo I - Dos Crimes contra a Vida. artigo 121. Matar alguém:');
    expect(s[1]!.chunks.join(' ')).toBe('artigo 122. Induzir alguém. Inciso 1: por motivo egoístico.');
  });
  it('artigo revogado é só anunciado', () => {
    expect(lawSpeech([art({ revoked: true, text: 'Art. 121. (Revogado)' })])[0]!.chunks.join(' ')).toContain('artigo 121: revogado.');
  });
});
