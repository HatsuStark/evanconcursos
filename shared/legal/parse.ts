// Separa o HTML de uma lei compilada (normas.leg.br) em artigos: rótulo, número para ordenação,
// texto (caput, parágrafos, incisos), notas de alteração, revogação e o título/capítulo onde está.
// Usa só expressões regulares: roda igual no Deno (Edge Functions) e no Node (testes).

export interface LegalArticle {
  ord: number;            // ordem no texto
  label: string;          // "4", "311-A", "1.025", "ADCT 1"
  num: number;            // parte numérica, para intervalos ("arts. 312 a 315")
  suffix: string;         // "A" em 311-A
  heading: string;        // "TÍTULO II – DO INQUÉRITO POLICIAL › CAPÍTULO I – ..."
  text: string;           // parágrafos separados por \n
  notes: string[];        // "(Redação dada pela Lei nº ...)"
  revoked: boolean;
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', quot: '"', lt: '<', gt: '>', ordm: 'º', ordf: 'ª', deg: '°', sect: '§', ndash: '–', mdash: '—', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…', apos: "'" };
// Letras acentuadas ("&iacute;", "&Ccedil;", "&atilde;"): letra + acento combinado, normalizado.
const MARKS: Record<string, string> = { acute: '́', grave: '̀', circ: '̂', tilde: '̃', cedil: '̧', uml: '̈' };
export const decodeEntities = (s: string) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-zA-Z])(acute|grave|circ|tilde|cedil|uml);/g, (_, c, m) => (c + MARKS[m]).normalize('NFC'))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

const clean = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const HEADING_RE = /^(PARTE|LIVRO|T[ÍI]TULO|CAP[ÍI]TULO|SE[ÇC][ÃA]O|SUBSE[ÇC][ÃA]O)\b/i;
const LEVEL: Record<string, number> = { PARTE: 0, LIVRO: 1, TITULO: 2, CAPITULO: 3, SECAO: 4, SUBSECAO: 5 };
const levelOf = (s: string) => LEVEL[s.split(/\s/)[0]!.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()] ?? 6;
// Rubrica: linha curta, sem pontuação final, que não é parágrafo, inciso, alínea ou pena.
const isRubric = (s: string) => s.length <= 90 && /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(s) && !/[.:;,]$/.test(s) && !/^(§|Pena|Parágrafo|[IVXLC]+\s*[-–]|[a-z]\))/.test(s);
const ART_RE = /^Art\.\s*(\d{1,3}(?:\.\d{3})*)\s*(?:º|°|o(?=\s))?\s*(?:-\s*([A-Z]{1,2})\b)?\s*\.?\s*/;

export function parseLawHtml(html: string): LegalArticle[] {
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '');
  const out: LegalArticle[] = [];
  const headings: { level: number; text: string }[] = [];
  let pendingHeading: { level: number; text: string } | null = null;
  let current: LegalArticle | null = null;
  let adct = false;
  let orphanRubric = ''; // rubrica logo depois de um título, antes do primeiro artigo
  const seen = new Set<string>();

  for (const m of body.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)) {
    const attrs = m[1] ?? '', inner = m[2] ?? '';
    // Notas de alteração vêm em trechos com link/itálico entre parênteses.
    const notes = [...inner.matchAll(/<span[^>]*class="Hyperlink"[^>]*>([\s\S]*?)<\/span>/gi)].map((n) => clean(n[1]!)).filter((n) => /^\(.*\)$/.test(n));
    let text = clean(inner);
    for (const n of notes) text = text.replace(n, '').trim();
    if (!text && !notes.length) continue;
    const centered = /text-align:\s*center/i.test(attrs);

    // Só o título centralizado abre o ADCT (o nome também aparece citado dentro de artigos).
    if (centered && /^ATO DAS DISPOSI[ÇC][ÕO]ES CONSTITUCIONAIS TRANSIT[ÓO]RIAS$/i.test(text)) { adct = true; headings.length = 0; headings.push({ level: 0, text: 'ADCT' }); current = null; continue; }
    if (centered && HEADING_RE.test(text)) {
      const level = levelOf(text);
      while (headings.length && headings[headings.length - 1]!.level >= level) headings.pop();
      pendingHeading = { level, text };
      headings.push(pendingHeading);
      current = null;
      continue;
    }
    if (centered && pendingHeading && !ART_RE.test(text)) {
      // Linha seguinte ao "TÍTULO II": o nome do título.
      pendingHeading.text = `${pendingHeading.text} – ${text}`;
      pendingHeading = null;
      continue;
    }
    pendingHeading = null;

    const a = ART_RE.exec(text);
    if (a) {
      // Rubrica ("Peculato mediante erro de outrem") vem antes do "Art." e pertence ao artigo novo.
      let rubric = orphanRubric;
      orphanRubric = '';
      if (current) {
        const lines = current.text.split('\n'), last = lines[lines.length - 1]!;
        if (lines.length > 1 && isRubric(last)) { rubric = last; current.text = lines.slice(0, -1).join('\n'); }
      }
      const num = Number(a[1]!.replace(/\./g, '')), suffix = a[2] ?? '';
      let label = `${a[1]}${suffix ? '-' + suffix : ''}`;
      if (adct) label = `ADCT ${label}`;
      if (seen.has(label)) label = `${label} (${out.filter((x) => x.label.startsWith(label)).length + 1})`;
      seen.add(label);
      const rest = text.slice(a[0].length).trim();
      current = {
        ord: out.length, label, num, suffix, heading: headings.map((h) => h.text).join(' › '),
        text: (rubric ? rubric + '\n' : '') + `Art. ${a[1]}${suffix ? '-' + suffix : ''}${/[º°]/.test(a[0]) ? 'º' : '.'} ${rest}`.trim(),
        notes: [...notes], revoked: !rest && notes.some((n) => /revogad/i.test(n)),
      };
      out.push(current);
      continue;
    }
    if (current) {
      if (text) current.text += '\n' + text;
      current.notes.push(...notes);
    } else if (text && isRubric(text)) orphanRubric = text;
  }
  return out;
}

// ---------- normas em texto corrido (PDF), ex.: Normas Judiciais da Corregedoria Geral da Justiça de SP ----------
// Entrada: o texto do PDF com as páginas marcadas por "=== PÁGINA n ===" (evals/pdf-text.mjs, unpdf). O corpo é o trecho
// mais longo a partir de um "Art. 1º" (antes dele ficam o sumário e os provimentos de abertura). Em cada página, as notas
// de rodapé ("1 Prov. CG 15/2020.") ficam no fim e saem, assim como a chamada delas no texto ("única).1", "SAJ 6").
// Artigo só abre em ordem crescente: "Art. 166 do CPC" no começo de uma linha quebrada não vira artigo novo. Aceita os
// erros de digitação do texto oficial ("Art.. 370", "Artigo 981", "Art. 1235").
const FOOTNOTE_RE = /^(\d{1,3})\s+(Provs?\.?s?|Provimento|Res\.|Resolução|L\.|Lei|D\.|Decreto|Port\.|Portaria|Assento|Incluíd[oa]|Vide|Comunicado|Com\.|Redação|Acrescid[oa]|Revogad[oa])\b/;
const NEW_PARAGRAPH = /^(Art\.\s|§|Parágrafo único|[IVXLC]+\s*[-–]|[a-z]\)\s)/;
const NORM_HEADING_RE = /^(CAP[ÍI]TULO|SE[ÇC][ÃA]O|Se[çc][ãa]o|SUBSE[ÇC][ÃA]O|Subse[çc][ãa]o)\s+[IVXLC]+\b/;
const NORM_ART_RE = /^(?:Art\.{1,2}|Artigo)\s*(\d{1,3}(?:\.\d{3})+|\d{1,4})\s*(?:º|°|o(?=\s))?\s*(?:-\s*([A-Z]{1,2})\b)?\s*\.?\s*-?\s*/;
const UPPER_RE = /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9 ,;:–\-]+$/;
// 1235 → "1.235", como no resto do texto.
const normLabel = (n: number) => n.toLocaleString('pt-BR').replace(/\s/g, '.');

export function parseNormsText(raw: string): LegalArticle[] {
  const lines: string[] = [];
  for (const page of raw.split(/^=== PÁGINA \d+ ===$/m)) {
    const ls = page.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const cut = ls.findIndex((l) => FOOTNOTE_RE.test(l));
    const marks = new Set((cut >= 0 ? ls.slice(cut) : []).map((l) => FOOTNOTE_RE.exec(l)?.[1]).filter((n): n is string => !!n));
    for (let l of cut >= 0 ? ls.slice(0, cut) : ls) {
      // Número de página e rodapé de impressão ("12", "Página 3 de 40") não são texto da norma.
      if (/^(\d{1,4}|p[áa]gina\s+\d+(\s+de\s+\d+)?|\d+\s*\/\s*\d+)$/i.test(l)) continue;
      l = l.replace(/([.;:)”"])\s*(\d{1,3})$/, (m, p, n) => (marks.has(n) ? p : m));
      // Títulos e nomes de seção (linhas curtas) também levam chamada de nota: "Seção IV 6", "Do Sistema Informatizado Oficial 2".
      if (NORM_HEADING_RE.test(l) || UPPER_RE.test(l) || l.length < 70) l = l.replace(/([A-Za-zÀ-ú])\s(\d{1,3})$/, (m, w, n) => (marks.has(n) ? w : m));
      lines.push(l);
    }
  }
  const firsts = lines.map((l, i) => (/^Art\.\s*1\s*º/.test(l) ? i : -1)).filter((i) => i >= 0);
  let start = firsts.map((i, k) => ({ i, len: (firsts[k + 1] ?? lines.length) - i })).sort((x, y) => y.len - x.len)[0]?.i ?? 0;
  // O título do capítulo fica nas linhas logo antes do Art. 1º.
  while (start > 0 && (NORM_HEADING_RE.test(lines[start - 1]!) || UPPER_RE.test(lines[start - 1]!))) start--;

  const out: LegalArticle[] = [];
  const headings: { level: number; text: string }[] = [];
  let pending: { level: number; text: string } | null = null;
  let current: LegalArticle | null = null;
  let last = 0;
  for (const line of lines.slice(start)) {
    if (NORM_HEADING_RE.test(line)) {
      const level = levelOf(line);
      while (headings.length && headings[headings.length - 1]!.level >= level) headings.pop();
      pending = { level, text: line };
      headings.push(pending);
      continue;
    }
    const a = NORM_ART_RE.exec(line);
    const num = a ? Number(a[1]!.replace(/\./g, '')) : 0, suffix = a?.[2] ?? '';
    const key = num * 100 + (suffix ? suffix.charCodeAt(0) - 64 : 0);
    if (a && key > last && key - last < 50_000) {
      pending = null;
      last = key;
      const label = `${normLabel(num)}${suffix ? '-' + suffix : ''}`;
      const rest = line.slice(a[0].length).trim();
      current = { ord: out.length, label, num, suffix, heading: headings.map((h) => h.text).join(' › '),
        text: `Art. ${label}${num < 10 && !suffix ? 'º' : '.'} ${rest}`.trim(), notes: [], revoked: /^\(?Revogad[oa]\)?\.?\s*\d{0,3}$/i.test(rest) };
      out.push(current);
      continue;
    }
    // Nome do capítulo ou seção nas linhas seguintes ("CAPÍTULO I" + "DA MISSÃO, VISÃO ..."; "Seção V" + "Do Sistema ...").
    if (pending && /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(line) && (UPPER_RE.test(line) || !pending.text.includes('–'))) {
      pending.text = pending.text.includes('–') ? `${pending.text} ${line}` : `${pending.text} – ${line}`;
      continue;
    }
    pending = null;
    if (current) current.text += (NEW_PARAGRAPH.test(line) ? '\n' : ' ') + line;
  }
  return out;
}
