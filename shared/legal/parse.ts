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
export const decodeEntities = (s: string) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
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
