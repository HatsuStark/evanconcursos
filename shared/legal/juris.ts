// Jurisprudência oficial do STF e do STJ: leitura das fontes publicadas pelos tribunais e ligação de cada súmula ou tese
// aos artigos de lei do registro. Funções puras (sem rede), usadas por scripts/juris-seed.ts e testadas em juris.test.ts.
// Fontes (conferidas em nov/2026):
// - Súmulas do STJ: PDF "Súmulas do STJ" (inteiro teor), com "Referências Legislativas" estruturadas por súmula.
// - Repetitivos e IAC do STJ: dadosabertos.web.stj.jus.br, conjunto "precedentes-qualificados" (Temas.csv).
// - Súmulas e súmulas vinculantes do STF: portal.stf.jus.br/jurisprudencia/sumariosumulas.asp (lista e uma página por súmula).
// - Teses de repercussão geral do STF: portal.stf.jus.br/repercussaogeral/teses.asp (JSON da própria página).
import { findLawRefs } from './refs.ts';
import { LAWS } from './registry.ts';

export type Court = 'STF' | 'STJ';
export type PrecedentKind = 'sumula_vinculante' | 'sumula' | 'repercussao_geral' | 'repetitivo' | 'iac';
export type LinkOrigin = 'referencia' | 'citacao' | 'ia';
export interface PrecedentLink { law: string; art: number; origin: LinkOrigin }
export interface Precedent {
  court: Court; kind: PrecedentKind; number: number; text: string; subject: string; decidedOn: string | null;
  active: boolean; sourceUrl: string; links: PrecedentLink[];
}

export const KIND_LABEL: Record<PrecedentKind, string> = {
  sumula_vinculante: 'Súmula Vinculante', sumula: 'Súmula', repercussao_geral: 'Tema de Repercussão Geral', repetitivo: 'Tema Repetitivo', iac: 'IAC',
};
// "Súmula 17/STJ", "Súmula Vinculante 5", "Tema 1103/STF".
export function precedentLabel(p: { court: Court; kind: PrecedentKind; number: number }) {
  return p.kind === 'sumula_vinculante' ? `Súmula Vinculante ${p.number}` : `${KIND_LABEL[p.kind]} ${p.number}/${p.court}`;
}

// Súmulas e temas citados num texto ("Súmula 17 do STJ", "Súmula Vinculante 5", "Tema 1103/STF") que não estão entre os
// fornecidos: a apostila só pode citar a jurisprudência que recebeu.
const PRECEDENT_RE = /\bS[úu]mula\s+(Vinculante\s+)?(?:n[º°o.]*\s*)?(\d{1,4})(?:\s*(?:\/|-|do|da)\s*(STF|STJ))?|\bTema\s+(?:n[º°o.]*\s*)?(\d{1,4})(?:\s*(?:\/|-|do|da)\s*(STF|STJ))?/gi;
export function unverifiedPrecedents(text: string, provided: { court: Court; kind: PrecedentKind; number: number }[]) {
  const out = new Set<string>();
  for (const m of text.matchAll(PRECEDENT_RE)) {
    const vinc = !!m[1], n = Number(m[2] ?? m[4]), court = (m[3] ?? m[5])?.toUpperCase() as Court | undefined;
    const sumula = m[2] != null;
    const ok = provided.some((p) => p.number === n && (!court || p.court === court)
      && (sumula ? p.kind === (vinc ? 'sumula_vinculante' : 'sumula') : p.kind === 'repercussao_geral' || p.kind === 'repetitivo' || p.kind === 'iac'));
    if (!ok) out.add(`${sumula ? (vinc ? 'Súmula Vinculante' : 'Súmula') : 'Tema'} ${n}${court && !vinc ? `/${court}` : ''}`);
  }
  return [...out];
}

const MAX_RANGE = 30; // intervalo citado maior que isso ("arts. 1º a 200") não liga artigo por artigo
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

// Artigos citados no próprio texto ("nos termos do art. 161, § 1º, do CTN"), só de leis do registro.
export function citedLinks(text: string): PrecedentLink[] {
  return findLawRefs(text).flatMap((r) => r.ranges.filter((g) => g.to - g.from < MAX_RANGE)
    .flatMap((g) => Array.from({ length: g.to - g.from + 1 }, (_, i) => ({ law: r.law, art: g.from + i, origin: 'citacao' as const }))));
}

export function dedupeLinks(links: PrecedentLink[]): PrecedentLink[] {
  const rank: Record<LinkOrigin, number> = { referencia: 0, citacao: 1, ia: 2 };
  const out = new Map<string, PrecedentLink>();
  for (const l of links) {
    const k = `${l.law}:${l.art}`, prev = out.get(k);
    if (!prev || rank[l.origin] < rank[prev.origin]) out.set(k, l);
  }
  return [...out.values()];
}

// ---------- STJ: referência legislativa ("LEG:FED DEL:002848 ANO:1940" … "ART:00070 ART:00171") ----------

// Tipo do STJ → tipo da URN LexML. A CF vem como CFB ou CFD, sem número.
const STJ_TYPES: Record<string, string> = { LEI: 'lei', DEL: 'decreto.lei', LCP: 'lei.complementar' };
const URN_KEYS = new Map(LAWS.flatMap((l) => {
  const m = /^urn:lex:br:federal:([a-z.]+):(\d{4})-\d{2}-\d{2};(\d+)$/.exec(l.urn);
  return m ? [[`${m[1]}:${Number(m[3])}:${m[2]}`, l.key] as const] : [];
}));

export function stjLawKey(type: string, num: string, year: string): string | null {
  if ((type === 'CFB' || type === 'CFD') && year === '1988') return 'CF';
  const t = STJ_TYPES[type];
  return t && /^\d+$/.test(num) ? URN_KEYS.get(`${t}:${Number(num)}:${year}`) ?? null : null;
}

// Bloco de referências de uma súmula. Artigo seguido de "(REVOGADO…)" fica de fora: a redação citada já não vale.
export function parseStjReferences(block: string): PrecedentLink[] {
  const links: PrecedentLink[] = [];
  let law: string | null = null;
  const lines = block.split('\n').map((l) => l.trim());
  lines.forEach((line, i) => {
    const leg = /^LEG:\w+ (\w+):([\d*]+) ANO:(\d{4})/.exec(line);
    if (leg) { law = stjLawKey(leg[1]!, leg[2]!, leg[3]!); return; }
    if (!law || !/^ART:\d+/.test(line) || /^\(REVOGAD/i.test(lines[i + 1] ?? '')) return;
    for (const m of line.matchAll(/ART:(\d+)/g)) links.push({ law, art: Number(m[1]), origin: 'referencia' });
  });
  return links;
}

// Texto do PDF "Súmulas do STJ" (linhas de cada página). Cada súmula: "SÚMULA 17" (ou "SÚMULA 61 (SÚMULA CANCELADA)",
// "SÚMULA 203 (SÚMULA ALTERADA)", já com a redação nova, ou REVOGADA),
// ramo (até três linhas), "Enunciado:", texto, "Referências Legislativas:", …, "Data da decisão:". Cabeçalho
// ("17. Súmula 17") e rodapé ("INTEIRO TEOR DAS SÚMULAS …", endereço e página) se repetem em toda página e saem antes.
export function parseStjSumulas(text: string): Precedent[] {
  const out = new Map<number, Precedent>();
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => !/^(\d+\. Súmula \d+|INTEIRO TEOR DAS SÚMULAS.*|scon\.stj\.jus\.br\S* \d+|=== PÁGINA ===)$/.test(l.trim()));
  const parts = lines.join('\n').split(/^SÚMULA (\d+)(?: \(SÚMULA (CANCELADA|REVOGADA|ALTERADA)\))?$/m);
  for (let i = 1; i + 2 < parts.length; i += 3) {
    const number = Number(parts[i]), head = /^\n([\s\S]*?)\nEnunciado:\n([\s\S]*)$/.exec(parts[i + 2]!);
    if (!head || head[1]!.split('\n').length > 3) continue; // repetição do título fora do inteiro teor
    const body = head[2]!;
    const end = body.search(/^(Referências Legislativas|Órgão Julgador|Excerto dos Precedentes|Precedentes):/m);
    let enunciado = clean(end < 0 ? body : body.slice(0, end));
    // Súmula cancelada ou alterada traz a nota do colegiado logo após o enunciado ("A Segunda Seção, na sessão…",
    // "(*) - apreciando o projeto…"): o enunciado vai até ela.
    const note = enunciado.search(/\s\(\*\)|\b(?:A|O) (?:Primeira|Segunda|Terceira) Seção,? na sessão|\bA Corte Especial,? na sessão/);
    if (note > 0) enunciado = enunciado.slice(0, note).trim();
    const cancelled = parts[i + 1] === 'CANCELADA' || parts[i + 1] === 'REVOGADA';
    const refs = /^Referências Legislativas:\n([\s\S]*?)^Órgão Julgador:/m.exec(body)?.[1] ?? '';
    const date = /^Data da decisão:\n(\d{2})\/(\d{2})\/(\d{4})/m.exec(body);
    if (!enunciado || out.has(number)) continue;
    out.set(number, {
      court: 'STJ', kind: 'sumula', number, text: enunciado, subject: clean(head[1]!), decidedOn: date ? `${date[3]}-${date[2]}-${date[1]}` : null,
      active: !cancelled, sourceUrl: `https://scon.stj.jus.br/SCON/sumstj/toc.jsp?livre=%27${number}%27.num.&b=SUMU`,
      links: dedupeLinks([...parseStjReferences(refs), ...citedLinks(enunciado)]),
    });
  }
  return [...out.values()].sort((a, b) => a.number - b.number);
}

// ---------- STJ: Temas.csv (precedentes qualificados) ----------

export function parseCsv(text: string, sep = ','): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field); field = ''; } else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; } else field += c;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const [head, ...body] = rows;
  const keys = (head ?? []).map((h) => h.replace(/^\uFEFF/, '').trim());
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])));
}

// Só temas julgados com tese em vigor. Revisado/cancelado: a tese publicada já não é a vigente.
const STJ_JUDGED = new Set(['Trânsito em Julgado', 'Acórdão Publicado', 'Acórdão Publicado - RE Pendente', 'Mérito Julgado']);

// O CSV repete alguns temas (mesma tese em mais de uma linha): fica um por número, o vigente se houver.
export function stjTemas(rows: Record<string, string>[]): Precedent[] {
  const out = new Map<string, Precedent>();
  for (const p of stjTemaRows(rows)) {
    const k = `${p.kind}:${p.number}`, prev = out.get(k);
    if (!prev || (p.active && !prev.active)) out.set(k, p);
  }
  return [...out.values()];
}

function stjTemaRows(rows: Record<string, string>[]): Precedent[] {
  return rows.flatMap((r) => {
    const kind = r.tipoPrecedente === 'Tema' ? 'repetitivo' : r.tipoPrecedente === 'IAC' ? 'iac' : null;
    const number = Number(r.numeroPrecedente), tese = clean(r.teseFirmada ?? '');
    if (!kind || !number || !tese) return [];
    const subject = clean((r.Assuntos ?? '').replace(/\d+-\s*/g, ''));
    return [{
      court: 'STJ' as const, kind, number, text: tese, subject, decidedOn: /^\d{4}-\d{2}-\d{2}$/.test(r.dataJulgamento ?? '') ? r.dataJulgamento! : null,
      active: STJ_JUDGED.has(r.situacao ?? ''),
      sourceUrl: `https://processo.stj.jus.br/repetitivos/temas_repetitivos/pesquisa.jsp?novaConsulta=true&tipo_pesquisa=${kind === 'iac' ? 'I' : 'T'}&cod_tema_inicial=${number}&cod_tema_final=${number}`,
      links: dedupeLinks(citedLinks(`${tese}\n${r.referenciaLegislativa ?? ''}`)),
    }];
  });
}

// ---------- STF ----------

const MARKS: Record<string, string> = { acute: '́', grave: '̀', circ: '̂', tilde: '̃', uml: '̈', cedil: '̧' };
const NAMED: Record<string, string> = {
  nbsp: ' ', quot: '"', amp: '&', lt: '<', gt: '>', ordm: 'º', ordf: 'ª', sect: '§', deg: '°', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', ndash: '–', mdash: '—', hellip: '…',
};
export function decodeHtml(s: string) {
  return s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => { const c = Number(n); return c === 8203 ? '' : String.fromCharCode(c >= 128 && c < 160 ? WIN1252[c - 128] ?? 32 : c); })
    .replace(/&([A-Za-z])(acute|grave|circ|tilde|uml|cedil);/g, (_, l: string, m: string) => (l + MARKS[m]).normalize('NFC'))
    .replace(/&([a-z]+);/g, (e, n: string) => NAMED[n] ?? e);
}
// Entidades 128–159 da página do STF vêm no Windows-1252 (&#147; = “, &#151; = —).
const WIN1252: Record<number, number> = { 17: 0x2018, 18: 0x2019, 19: 0x201c, 20: 0x201d, 22: 0x2013, 23: 0x2014 };

// Lista de súmulas (base=30) ou vinculantes (base=26): id da página, número e situação.
export function parseStfSumulaList(html: string) {
  const out: { id: number; number: number; active: boolean }[] = [];
  for (const m of html.matchAll(/sumula-item"><a[^>]*sumula=(\d+)">\s*([\s\S]*?)<\/a>/g)) {
    const label = decodeHtml(m[2]!).replace(/\s+/g, ' ').trim();
    const n = /Súmula(?: Vinculante)? (\d+)/i.exec(label);
    if (n) out.push({ id: Number(m[1]), number: Number(n[1]), active: !/\((cancelada|revogada|superada)\)/i.test(label) });
  }
  return out;
}

// Enunciado: o primeiro parágrafo depois do título "Súmula N" (o resto da página são precedentes e comentários).
export function parseStfSumulaPage(html: string) {
  const m = /<div class="titulo">\s*Súmula(?: Vinculante)?(?:&nbsp;|\s)+\d+[\s\S]*?<\/div>\s*<div class="parCOM">([\s\S]*?)<\/div>/i.exec(html);
  return m ? clean(decodeHtml(m[1]!)) : '';
}

export function stfSumula(kind: 'sumula' | 'sumula_vinculante', item: { id: number; number: number; active: boolean }, text: string): Precedent {
  return {
    court: 'STF', kind, number: item.number, text, subject: '', decidedOn: null, active: item.active,
    sourceUrl: `https://portal.stf.jus.br/jurisprudencia/sumariosumulas.asp?base=${kind === 'sumula' ? 30 : 26}&sumula=${item.id}`,
    links: dedupeLinks(citedLinks(text)),
  };
}

export interface StfThesis { numeroTema: string; incidente: string; siglaClasse: string; numeroProcesso: string; descricaoTese: string; dataAndamento: string }
export function stfTheses(list: StfThesis[]): Precedent[] {
  const out = new Map<number, Precedent>();
  for (const t of list) {
    const number = Number(t.numeroTema), text = clean(decodeHtml(t.descricaoTese ?? ''));
    if (!number || !text || out.has(number)) continue;
    const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t.dataAndamento ?? '');
    out.set(number, {
      court: 'STF', kind: 'repercussao_geral', number, text, subject: '', decidedOn: d ? `${d[3]}-${d[2]}-${d[1]}` : null, active: true,
      sourceUrl: `https://portal.stf.jus.br/jurisprudenciaRepercussao/verAndamentoProcesso.asp?incidente=${t.incidente}&numeroProcesso=${t.numeroProcesso}&classeProcesso=${t.siglaClasse}&numeroTema=${number}`,
      links: dedupeLinks(citedLinks(text)),
    });
  }
  return [...out.values()];
}
