// Barreira antes da IA na leitura do edital: PDF grande demais ou que é o texto de uma lei (não um edital) é recusado
// sem gastar tokens. Edital costuma ter de 20 a 150 páginas; a leitura manda o PDF inteiro, então o custo cresce com ele.

export const MAX_NOTICE_PAGES = 300;
export const MAX_NOTICE_CHARS = 1_500_000; // ~400 mil tokens de texto
// Lei com dezenas de artigos; edital cita artigos no meio da frase, quase nunca no começo da linha.
const MIN_LAW_ARTICLES = 60;
const FIRST_PAGES = 5;

const ART_LINE_RE = /^\s*(?:Art\.{1,2}|Artigo)\s*\d/gim;
const EDITAL_RE = /\bedital\b/i;
const INSCRICAO_RE = /\binscri[çc][ãaõo]/i;
const VAGAS_RE = /\bvagas?\b/i;
const CARGO_RE = /\bcargos?\b/i;

// O que um edital traz logo no começo: a palavra "edital", ou inscrição junto de cargo ou vagas.
export function looksLikeNotice(head: string) {
  return EDITAL_RE.test(head) || (INSCRICAO_RE.test(head) && (VAGAS_RE.test(head) || CARGO_RE.test(head)));
}

// pages: texto de cada página (vazio se o PDF é só imagem); totalPages: páginas do PDF, mesmo sem texto.
// Devolve a mensagem para o candidato, ou null se o PDF pode ir para a IA.
export function noticeGuard(pages: string[], totalPages: number): string | null {
  if (totalPages > MAX_NOTICE_PAGES) {
    return `Este PDF tem ${totalPages} páginas, mais do que um edital costuma ter (até ${MAX_NOTICE_PAGES}). Envie só o edital de abertura, sem anexos de legislação ou provas anteriores.`;
  }
  const text = pages.join('\n');
  if (text.length > MAX_NOTICE_CHARS) {
    return 'Este PDF tem texto demais para um edital. Envie só o edital de abertura, sem anexos de legislação ou provas anteriores.';
  }
  const articles = text.match(ART_LINE_RE)?.length ?? 0;
  if (articles >= MIN_LAW_ARTICLES && !looksLikeNotice(pages.slice(0, FIRST_PAGES).join('\n'))) {
    return 'Este PDF parece o texto de uma lei, não um edital. Envie o edital do concurso aqui; leis que faltarem no cronograma são enviadas na própria sessão de estudo.';
  }
  return null;
}
