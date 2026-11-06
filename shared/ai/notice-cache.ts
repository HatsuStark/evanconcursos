// Leituras do edital compartilhadas entre candidatos: o mesmo edital lido para o mesmo cargo não volta à IA.
// O edital é reconhecido pelo arquivo (hash do PDF) ou, se o PDF foi salvo de novo, baixado de outro site ou
// comprimido, pelo texto normalizado. Retificação muda o texto e é lida de novo. Edital é documento público: só entra
// no cache o que a IA leu do PDF, nunca a conferência de um candidato.
import { normalizeText, type NoticeExtraction } from './notice.ts';

// Texto curto demais (PDF só com imagem ou protegido) não identifica o edital: fica só o hash do arquivo.
export const MIN_TEXT_CHARS = 2000;

export async function sha256Hex(data: Uint8Array | string) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Chaves do edital, sempre calculadas no servidor sobre o PDF baixado (o hash enviado pelo app não vale: um PDF falso
// com o hash de um edital real envenenaria o cache dos outros).
export async function noticeDocKeys(bytes: Uint8Array, text: string | null): Promise<string[]> {
  const keys = [`pdf:${await sha256Hex(bytes)}`];
  const t = normalizeText(text ?? '');
  if (t.length >= MIN_TEXT_CHARS) keys.push(`txt:${await sha256Hex(t)}`);
  return keys;
}

// Cargo da leitura: escolhido na lista (código e nome) ou digitado.
export const noticeRoleKey = (roleHint: string, exact?: { code: string } | null) =>
  (exact ? `c:${normalizeText(exact.code)}|${normalizeText(roleHint)}` : `h:${normalizeText(roleHint)}`).slice(0, 400);

// Só vale guardar para os outros uma leitura que trouxe o conteúdo: matérias com tópicos.
export const worthSharing = (e: Pick<NoticeExtraction, 'subjects'>) => e.subjects.length > 0 && e.subjects.some((s) => s.topics.length > 0);

// ---------- mesmo edital em outro arquivo: título + assinatura do texto ----------
// O mesmo edital baixado de outro site ou gerado de novo muda os bytes e às vezes o texto extraído (quebras, hifenização,
// cabeçalho de página), e as chaves acima não batem. O título acha os candidatos ("EDITAL Nº 1 – CÂMARA DOS DEPUTADOS –
// ANALISTA LEGISLATIVO, DE 2 DE OUTUBRO DE 2026") e a assinatura do texto confirma que o conteúdo é praticamente o mesmo:
// retificação costuma manter o título e mudar datas e vagas, então título sozinho não basta.
const TITLE_CHARS = 240, TITLE_SEARCH_CHARS = 6000;
export const SIGNATURE_SIZE = 128;
export const SAME_TEXT_SIMILARITY = 0.97;

// Trecho que começa na primeira menção a "edital" no começo do documento (número, ano, órgão e, muitas vezes, o cargo).
export async function noticeTitleKey(text: string): Promise<string | null> {
  const t = normalizeText(text.slice(0, TITLE_SEARCH_CHARS * 2)).slice(0, TITLE_SEARCH_CHARS);
  const at = t.search(/\bedital\b/);
  if (at < 0) return null;
  const title = t.slice(at, at + TITLE_CHARS);
  return title.length >= 60 ? `ttl:${await sha256Hex(title)}` : null;
}

// MinHash das sequências de 5 palavras: a fração de posições iguais entre duas assinaturas estima quanto do texto é igual.
const fnv1a = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };
const fmix = (h: number) => { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; };
const SEEDS = Array.from({ length: SIGNATURE_SIZE }, (_, i) => fmix(i * 0x9e3779b9 + 1));
export function textSignature(text: string): number[] | null {
  const words = normalizeText(text).split(' ').filter(Boolean);
  if (words.length < 50) return null;
  const sig = new Array<number>(SIGNATURE_SIZE).fill(0xffffffff);
  for (let i = 0; i + 5 <= words.length; i++) {
    const h = fnv1a(words.slice(i, i + 5).join(' '));
    for (let k = 0; k < SIGNATURE_SIZE; k++) { const v = fmix(h ^ SEEDS[k]!); if (v < sig[k]!) sig[k] = v; }
  }
  // int4 no banco: guarda com sinal.
  return sig.map((v) => v | 0);
}
export const signatureSimilarity = (a: number[], b: number[]) => (a.length && a.length === b.length ? a.filter((v, i) => v === b[i]).length / a.length : 0);
