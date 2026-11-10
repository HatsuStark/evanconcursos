// Fontes da sessão nas matérias sem lei: trechos de obras abertas (open_source_chunks) que explicam o tema, escolhidos
// pela IA entre os que a busca achou, e livros de referência sugeridos pela IA e conferidos no Google Books. A IA não
// escreve o texto das fontes: escolhe trechos e diz em uma frase o que cada um explica.
import { z } from 'zod';

export const SOURCES_PROMPT_VERSION = 'sources-v1', BOOKS_PROMPT_VERSION = 'books-v1';
export const MAX_SOURCE_PICKS = 4, MAX_SOURCE_CANDIDATES = 20, MAX_BOOKS = 4;

export interface SourceMeta { key: string; title: string; authors: string; license: string; license_url: string; url: string; note: string; commercial_ok: boolean }
export interface SourceCandidate { id: string; source_key: string; page_from: number; page_to: number; heading: string; text: string; rank: number }
export interface SourceItem extends SourceCandidate { why: string; ref: string }
export interface BookRef { title: string; authors: string[]; publisher: string; year: string; link: string; isbn: string; why: string }

// Palavras que não ajudam a achar o assunto ("Noções de", "conceitos básicos", "aspectos gerais").
const STOP = new Set(('para pela pelo pelos pelas como entre sobre quando onde qual quais seus suas nosso esta este isto essa esse isso aquele aquela ' +
  'noção noções conceito conceitos básico básicos básica básicas geral gerais aspecto aspectos principais principal introdução estudo tipos tipo ' +
  'parte partes forma formas uso usos utilização características característica fundamentos fundamento definição definições ' +
  'demais outros outras através mais menos cada todo toda todos todas também ainda apenas sendo seja seus suas mesmo mesma').split(' '));

// Busca no formato web do Postgres ("a or b or c"), com as palavras que indicam o tema.
export function sourcesQuery(title: string, keyword = '') {
  const words = `${keyword} ${title}`.replace(/\([^)]*\)/g, ' ').toLowerCase().match(/[\p{L}\d][\p{L}\d-]{3,}/gu) ?? [];
  const terms = [...new Set(words.filter((w) => !STOP.has(w) && !/^\d+$/.test(w)))].slice(0, 12);
  return terms.join(' or ');
}

// "Guia do Writer 7.1, p. 45" / "pp. 45-46": como o trecho é citado na aba e na apostila.
export const chunkRef = (sourceTitle: string, c: { page_from: number; page_to: number }) =>
  `${sourceTitle}, ${c.page_to > c.page_from ? `pp. ${c.page_from}-${c.page_to}` : `p. ${c.page_from}`}`;

export const SourcePicks = z.object({
  itens: z.array(z.object({
    n: z.number().int().describe('Número do trecho na lista.'),
    explica: z.string().describe('Uma frase curta: o que o trecho explica do tema.'),
  })).describe('Trechos que explicam o tema, do mais útil para o menos útil.'),
});
export type SourcePicks = z.infer<typeof SourcePicks>;
export const sourcePicksJsonSchema = () => z.toJSONSchema(SourcePicks, { target: 'draft-7' });

export function sourcesPrompt(p: { subject: string; title: string; topics: string[]; items: (SourceCandidate & { sourceTitle: string })[] }) {
  return `Você prepara material de estudo para concursos públicos. Abaixo estão trechos de livros e guias abertos achados por busca de palavras para um tema de estudo.
Matéria: ${p.subject}
Tema: ${p.title}
Item do edital (contexto): ${p.topics.join(' | ') || '—'}
Trechos:
${p.items.map((c, i) => `${i}. [${c.sourceTitle}, p. ${c.page_from}${c.heading ? ` — ${c.heading}` : ''}] ${c.text.slice(0, 900)}`).join('\n\n')}
Regras:
- Escolha até ${MAX_SOURCE_PICKS} trechos que explicam DIRETAMENTE o tema (conceito, funcionamento, procedimento), do mais útil para o menos útil.
- Trecho que só cita palavras do tema de passagem, exercício sem explicação, ou assunto vizinho fica de fora. Se nenhum servir, devolva a lista vazia.
- explica: uma frase curta (até 140 caracteres) dizendo o que o trecho ensina do tema.`;
}

// Escolhidos, na ordem da IA; sem escolha (sem acesso à IA ou falha), os primeiros da busca, sem frase.
export function mergeSourcePicks(candidates: SourceCandidate[], picks: SourcePicks | null, titleOf: (key: string) => string): SourceItem[] {
  const item = (c: SourceCandidate, why: string): SourceItem => ({ ...c, why, ref: chunkRef(titleOf(c.source_key), c) });
  if (!picks) return candidates.slice(0, MAX_SOURCE_PICKS).map((c) => item(c, ''));
  const seen = new Set<number>(), out: SourceItem[] = [];
  for (const p of picks.itens) {
    if (!candidates[p.n] || seen.has(p.n) || out.length >= MAX_SOURCE_PICKS) continue;
    seen.add(p.n);
    out.push(item(candidates[p.n]!, p.explica.trim().slice(0, 200)));
  }
  return out;
}

// ---------- livros de referência ----------

export const BookSuggestions = z.object({
  livros: z.array(z.object({
    titulo: z.string().describe('Título da edição em português.'),
    autor: z.string().describe('Sobrenome do autor principal.'),
    por_que: z.string().describe('Uma frase: para que o livro serve nesta matéria.'),
  })),
});
export type BookSuggestions = z.infer<typeof BookSuggestions>;
export const bookSuggestionsJsonSchema = () => z.toJSONSchema(BookSuggestions, { target: 'draft-7' });

export function booksPrompt(p: { subject: string; title: string }) {
  return `Indique até ${MAX_BOOKS + 2} livros de referência consagrados, com edição em português no Brasil, que professores e candidatos de concursos usam para estudar o tema abaixo.
Matéria: ${p.subject}
Tema: ${p.title}
Regras:
- Só livros que você tem certeza que existem, com o título da edição brasileira (ex.: "Engenharia de Software", Sommerville). Nada de apostilas de cursinho nem títulos inventados.
- autor: só o sobrenome do autor principal.
- por_que: uma frase curta (até 120 caracteres) sobre o que o livro cobre do tema.`;
}

const normWords = (s: string): string[] => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];

// Livro sugerido confere com um resultado do Google Books: sobrenome do autor entre os autores e a maioria das
// palavras do título no título achado.
export function bookMatches(s: { titulo: string; autor: string }, v: { title?: string; subtitle?: string; authors?: string[] }) {
  const surname = normWords(s.autor).at(-1);
  if (!surname || !(v.authors ?? []).some((a) => normWords(a).includes(surname))) return false;
  const want = normWords(s.titulo), got = new Set(normWords(`${v.title ?? ''} ${v.subtitle ?? ''}`));
  return want.length > 0 && want.filter((w) => got.has(w)).length / want.length >= 0.7;
}
