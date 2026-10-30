// Texto da apostila preparado para leitura em voz alta: siglas e abreviações por extenso, em trechos curtos
// (alguns navegadores interrompem falas longas). Cada seção corresponde a um bloco da tela (key).
export interface SpeechSection { key: string; title: string; chunks: string[] }

interface SpeakableGuide {
  titulo: string; introducao: string;
  secoes: { titulo: string; texto: string; exemplos: string[] }[];
  legislacao: { ref: string; comentario: string }[];
  pontos_banca: string[]; pegadinhas: string[]; resumo: string[];
  perguntas: { pergunta: string; resposta: string }[];
}

const SPOKEN: [RegExp, string][] = [
  [/[*`#]+/g, ''],
  [/\barts\.\s*/gi, 'artigos '], [/\bart\.\s*/gi, 'artigo '],
  [/§§\s*/g, 'parágrafos '], [/§\s*/g, 'parágrafo '],
  [/\bincs?\.\s*/gi, 'inciso '], [/\bal\.\s*/gi, 'alínea '], [/\bn[º°.]\s*(?=\d)/gi, 'número '],
  [/\bc\/c\b/gi, 'combinado com'],
  [/\bCF(?:\/88)?\b/g, 'Constituição Federal'], [/\bCPP\b/g, 'Código de Processo Penal'], [/\bCPC\b/g, 'Código de Processo Civil'],
  [/\bCP\b/g, 'Código Penal'], [/\bCC\b/g, 'Código Civil'], [/\bCDC\b/g, 'Código de Defesa do Consumidor'],
  [/\s+/g, ' '],
];
export const spoken = (t: string) => SPOKEN.reduce((s, [re, to]) => s.replace(re, to), t).trim();

const MAX_CHUNK = 220;
// Corta em frases e junta as curtas; frase longa demais é cortada nas vírgulas e, em último caso, nos espaços.
export function speechChunks(t: string): string[] {
  const parts = spoken(t).split(/(?<=[.!?;:])\s+/).flatMap((s) => {
    if (s.length <= MAX_CHUNK) return [s];
    const out: string[] = [];
    let rest = s;
    while (rest.length > MAX_CHUNK) {
      const head = rest.slice(0, MAX_CHUNK);
      const comma = head.lastIndexOf(', '), space = head.lastIndexOf(' ');
      const cut = comma > 0 ? comma + 1 : space > 0 ? space : MAX_CHUNK;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    return [...out, rest];
  });
  const chunks: string[] = [];
  for (const p of parts.filter(Boolean)) {
    const last = chunks[chunks.length - 1];
    if (last !== undefined && last.length + p.length + 1 <= MAX_CHUNK) chunks[chunks.length - 1] = `${last} ${p}`;
    else chunks.push(p);
  }
  return chunks;
}

export function guideSpeech(g: SpeakableGuide): SpeechSection[] {
  const section = (key: string, title: string, texts: string[]): SpeechSection => ({ key, title, chunks: [title, ...texts].flatMap(speechChunks) });
  const list = (key: string, title: string, items: string[]) => (items.length ? [section(key, title, items)] : []);
  return [
    section('intro', g.titulo, [g.introducao]),
    ...g.secoes.map((s, i) => section(`s${i}`, s.titulo, [s.texto, ...s.exemplos.map((e) => `Exemplo: ${e}`)])),
    ...list('lei', 'Lei seca comentada', g.legislacao.map((l) => `${l.ref}: ${l.comentario}`)),
    ...list('banca', 'O que mais cai', g.pontos_banca),
    ...list('pegadinhas', 'Pegadinhas', g.pegadinhas),
    ...list('resumo', 'Resumo', g.resumo),
    ...list('perguntas', 'Perguntas de revisão', g.perguntas.map((q, i) => `Pergunta ${i + 1}: ${q.pergunta} Resposta: ${q.resposta}`)),
  ];
}
