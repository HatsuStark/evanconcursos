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
