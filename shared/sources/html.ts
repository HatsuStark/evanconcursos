// Páginas HTML de fontes abertas publicadas como site: texto em linhas, com os títulos (h1-h6) marcados como no PDF
// (HEADING_MARK), para passar pelo mesmo chunkPages; links da obra na ordem de leitura; link da licença Creative Commons.
// Funções puras (regex, sem DOM), usadas por scripts/sources-seed.ts e testadas em html.test.ts.
import { HEADING_MARK } from './chunk.ts';

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»',
  ordm: 'º', ordf: 'ª', sect: '§', deg: '°', middot: '·', copy: '©', reg: '®', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  bull: '•', times: '×', divide: '÷', le: '≤', ge: '≥', ne: '≠', minus: '−', shy: '', zwnj: '', zwj: '', thinsp: ' ', ensp: ' ', emsp: ' ',
};
const MARKS: Record<string, string> = { acute: '́', grave: '̀', circ: '̂', tilde: '̃', uml: '̈', cedil: '̧' };

export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    if (e in NAMED) return NAMED[e]!;
    const m = /^([a-zA-Z])(acute|grave|circ|tilde|uml|cedil)$/.exec(e); // &aacute; &ccedil; &Atilde;
    return m ? (m[1]! + MARKS[m[2]!]).normalize('NFC') : all;
  });
}

const inline = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// Conteúdo principal: <main>, <article> ou o papel "main"; sem eles, o <body> inteiro.
function mainPart(html: string) {
  for (const re of [/<main\b[^>]*>([\s\S]*?)<\/main>/i, /<article\b[^>]*>([\s\S]*)<\/article>/i, /<div\b[^>]*role=["']main["'][^>]*>([\s\S]*)<\/div>/i]) {
    const m = re.exec(html);
    if (m && m[1]!.replace(/<[^>]+>/g, '').trim().length > 200) return m[1]!;
  }
  return /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
}

export function htmlToPage(html: string): { title: string; text: string } {
  const title = inline(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
  let s = mainPart(html.replace(/<!--[\s\S]*?-->/g, ''))
    // Fórmulas: o LaTeX do MathJax 2 (em <script type="math/tex">) e o texto alternativo do MathML ficam como texto.
    .replace(/<script\b[^>]*type=["']math\/tex[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi, (_, tex: string) => ` \\(${tex.trim()}\\) `)
    .replace(/<math\b[^>]*alttext=["']([^"']*)["'][^>]*>[\s\S]*?<\/math>/gi, (_, alt: string) => ` \\(${alt}\\) `)
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|button|template|select)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, _n: string, inner: string) => {
    const t = inline(inner).replace(/[¶#]$/, '').trim();
    return t ? `\n${HEADING_MARK}${t}\n` : '\n';
  });
  s = s.replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/?(p|div|section|table|tr|pre|blockquote|dd|dt|dl|ul|ol|figure|figcaption|caption|thead|tbody)\b[^>]*>/gi, '\n')
    .replace(/<\/?(td|th)\b[^>]*>/gi, ' ');
  const text = decodeEntities(s.replace(/<[^>]+>/g, '')).split('\n')
    .map((l) => (l.startsWith(HEADING_MARK) ? l : l.replace(/[ \t ]+/g, ' ').trim()))
    .filter((l) => l && l !== '•').join('\n');
  return { title, text };
}

// Links da página que casam com include, absolutos, sem âncora, na ordem em que aparecem e sem repetir.
export function pageLinks(html: string, base: string, include: RegExp): string[] {
  const out: string[] = [], seen = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*\bhref=["']([^"'#][^"']*)["']/gi)) {
    let u: URL;
    try { u = new URL(decodeEntities(m[1]!), base); } catch { continue; }
    u.hash = '';
    const href = u.href;
    if (!/^https?:$/.test(u.protocol) || !include.test(href) || seen.has(href)) continue;
    seen.add(href);
    out.push(href);
  }
  return out;
}

// Ordem de leitura de um site: cada página entra logo depois da página que a citou primeiro (índice → capítulo →
// seções do capítulo), até max páginas. fetchPage devolve o HTML (ou null se a página falhou).
export async function crawlSite(start: string, include: RegExp, max: number, fetchPage: (url: string) => Promise<string | null>) {
  const order = [start], seen = new Set(order), pages: { url: string; html: string }[] = [];
  for (let i = 0; i < order.length && pages.length < max; i++) {
    const html = await fetchPage(order[i]!);
    if (html == null) continue;
    pages.push({ url: order[i]!, html });
    const fresh = pageLinks(html, order[i]!, include).filter((u) => !seen.has(u));
    for (const u of fresh) seen.add(u);
    order.splice(i + 1, 0, ...fresh);
  }
  return pages;
}

// Link da licença Creative Commons declarado na página (rel="license" ou link para creativecommons.org/licenses).
export const licenseLink = (html: string) =>
  /href=["'](https?:\/\/creativecommons\.org\/licenses\/[^"']+)["']/i.exec(html)?.[1] ?? null;
