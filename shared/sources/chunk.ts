// Texto de PDFs de fontes abertas em trechos para leitura e busca: página a página, sem cabeçalhos e rodapés repetidos,
// sem sumário e legendas de figura, palavras hifenizadas emendadas, cada trecho com a página e a seção onde está.
// Funções puras, usadas por scripts/sources-seed.ts e testadas em chunk.test.ts.

export interface SourceChunk { ord: number; pageFrom: number; pageTo: number; heading: string; text: string }

export const CHUNK_MAX = 1400, CHUNK_MIN = 250;

// PDFs gerados pelo LaTeX trazem o acento separado da letra ("Seguranc¸a", "leil˜ao", "N ˜AO", "´e"). O espaço antes do
// acento só é falso depois da cedilha ou entre maiúsculas ("c¸ ˜oes", "N ˜AO"); antes de "´e" minúsculo ele separa palavras.
const MARK: Record<string, string> = { '˜': '̃', '´': '́', 'ˆ': '̂', '`': '̀', '¨': '̈' };
export function fixLatexAccents(s: string) {
  return s
    .replace(/¸\s+(?=[˜´ˆ`¨])/g, '¸')
    .replace(/([A-ZÇ])\s+(?=[˜´ˆ`¨][A-Z])/g, '$1')
    .replace(/([cC])¸/g, (_, c: string) => (c === 'c' ? 'ç' : 'Ç'))
    .replace(/([˜´ˆ`¨])\s?([aeiouAEIOUnNı])/g, (_, m: string, l: string) => ((l === 'ı' ? 'i' : l) + MARK[m]).normalize('NFC'));
}

const shape = (line: string) => line.trim().replace(/\d+/g, '#').replace(/\s+/g, ' ');

// Linhas que se repetem no topo ou no pé de muitas páginas (com o número da página trocado): cabeçalho ou rodapé.
export function runningLines(pages: string[][]) {
  const count = new Map<string, number>();
  for (const lines of pages) {
    const edge = new Set([...lines.slice(0, 2), ...lines.slice(-2)].map(shape).filter(Boolean));
    for (const s of edge) count.set(s, (count.get(s) ?? 0) + 1);
  }
  const min = Math.max(3, Math.ceil(pages.length * 0.15));
  return new Set([...count].filter(([s, n]) => n >= min && s !== '#').map(([s]) => s));
}

// Página de sumário ou índice: muitas linhas terminando em número de página ou com pontilhado.
const isToc = (lines: string[]) => {
  const real = lines.filter((l) => l.trim().length > 3);
  return real.length >= 6 && real.filter((l) => /(\.{3,}|\s)\d{1,4}\s*$/.test(l.trim())).length / real.length > 0.4;
};
// Título: linha marcada pela fonte maior (markHeadings) ou numerada com subnível ("2.4.3 Golpe do site"). Número solto
// ("8 Mover para cima") costuma ser item de lista.
export const HEADING_MARK = '§§ ';
const HEADING = /^(\d{1,2}(?:\.\d{1,2}){1,3})\.?\s+(\p{Lu}[^.!?]{2,90})$/u;
const CAPTION = /^(Figura|Tabela|Quadro)\s+\d+[:.–-]/i;
const PAGE_NUM = /^[\divxlc]{1,6}$/i;
// Cabeçalho com o capítulo e a página ("Configurar o LibreOffice | 15", "15 | Capítulo 2"): muda a cada capítulo.
const HEADER_WITH_PAGE = /^(.{3,90}\s\|\s*\d{1,4}|\d{1,4}\s*\|\s.{3,90})$/;

// Linhas de cada página com a altura da fonte (itens do pdf.js): as de fonte claramente maior que a do corpo do
// documento (mediana ponderada pelos caracteres) viram títulos, marcados com HEADING_MARK.
export function markHeadings(pages: { text: string; height: number }[][]): string[] {
  const sizes = pages.flat().flatMap((l) => Array(Math.min(l.text.length, 200)).fill(Math.round(l.height * 10) / 10) as number[]).sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)] ?? 0;
  return pages.map((lines) => lines.map((l) => {
    const t = l.text.trim();
    return body && l.height >= body * 1.18 && t.length >= 3 && t.length <= 100 && /\p{L}{3}/u.test(t) && !PAGE_NUM.test(t) ? HEADING_MARK + t : l.text;
  }).join('\n'));
}

// Itens de texto de uma página do pdf.js em linhas, com a maior altura de fonte de cada linha.
export function pageLines(items: { str?: string; hasEOL?: boolean; height?: number }[]) {
  const lines: { text: string; height: number }[] = [];
  let text = '', height = 0;
  for (const i of items) {
    if (typeof i.str !== 'string') continue;
    text += i.str;
    if (i.str.trim()) height = Math.max(height, i.height ?? 0);
    if (i.hasEOL) { lines.push({ text, height }); text = ''; height = 0; }
  }
  if (text) lines.push({ text, height });
  return lines;
}

export function chunkPages(raw: string[], opts: { latexAccents?: boolean; firstPage?: number; lastPage?: number } = {}): SourceChunk[] {
  const first = opts.firstPage ?? 1, last = opts.lastPage ?? raw.length;
  const pages = raw.map((p) => (opts.latexAccents ? fixLatexAccents(p) : p).replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim()));
  const running = runningLines(pages.map((lines) => lines.map((l) => (l.startsWith(HEADING_MARK) ? l.slice(HEADING_MARK.length) : l))));
  const out: SourceChunk[] = [];
  let heading = '', buf = '', from = 0, to = 0, lastWasHeading = false;
  const flush = () => {
    const text = buf.replace(/\s+/g, ' ').trim();
    if (text.length >= CHUNK_MIN) out.push({ ord: out.length, pageFrom: from, pageTo: to, heading, text });
    buf = '';
  };
  pages.forEach((lines, i) => {
    const page = i + 1;
    if (page < first || page > last || isToc(lines)) return;
    for (const line of lines) {
      const marked = line.startsWith(HEADING_MARK), t = (marked ? line.slice(HEADING_MARK.length) : line).trim();
      if (running.has(shape(t)) || PAGE_NUM.test(t) || CAPTION.test(t) || HEADER_WITH_PAGE.test(t)) continue;
      const h = HEADING.exec(t);
      if (marked || h) {
        // Título que continua na linha seguinte (também com fonte maior) vira um só.
        const title = h ? `${h[1]} ${h[2]!.trim()}` : t;
        if (marked && !buf && heading && from === page && lastWasHeading) heading = `${heading} ${title}`.slice(0, 160);
        else { flush(); heading = title; }
        from = page; to = page; lastWasHeading = true;
        continue;
      }
      lastWasHeading = false;
      if (!buf) from = page;
      to = page;
      // Hifenização no fim da linha ("subcon-" + "juntos"); hífen de palavra composta fica ("guarda-" + "chuva" raro).
      buf = /\p{Ll}-$/u.test(buf) && /^\p{Ll}/u.test(t) ? buf.slice(0, -1) + t : `${buf}${buf ? (/[.:;!?]$/.test(buf) ? '\n' : ' ') : ''}${t}`;
      if (buf.length >= CHUNK_MAX && /[.:;!?]$/.test(t)) flush();
    }
  });
  flush();
  return out;
}
