// Normas citadas em textos de edital ou de sessão que não estão no registro (ex.: "Resolução n.º 354/2020 do Conselho
// Nacional de Justiça", "Lei n.º 11.608, de 29/12/2003", "LC 1.111/2010"). Sem o texto oficial, o app não mostra a lei
// seca nem dá artigos à IA: o estudante pode enviar o PDF, e a norma enviada vira uma entrada de registro só dele.
import { LAWS, type LawEntry } from './registry.ts';

// kind/num/year/scope/org: para achar o texto (resolve.ts). scope: "estadual"/"federal" se a citação diz; vazio se não.
// org: o órgão citado ("RFB", "CONAMA" ou "Conselho Nacional de Justiça"), vazio se não houver.
export interface UnlistedNorm { key: string; citation: string; pattern: string; kind: string; num: string; year: string; scope: '' | 'estadual' | 'federal'; org: string }

const KINDS: { slug: string; re: string; name: string }[] = [
  { slug: 'lc', re: String.raw`Lei\s+Complementar|\bLC\b`, name: 'Lei Complementar' },
  { slug: 'dl', re: String.raw`Decreto-Lei`, name: 'Decreto-Lei' },
  { slug: 'lei', re: String.raw`\bLei\b`, name: 'Lei' },
  { slug: 'dec', re: String.raw`\bDecreto\b`, name: 'Decreto' },
  { slug: 'res', re: String.raw`Resolu[çc][ãa]o|\bRes\.`, name: 'Resolução' },
  { slug: 'prov', re: String.raw`Provimento|\bProv\.`, name: 'Provimento' },
  { slug: 'port', re: String.raw`Portaria`, name: 'Portaria' },
  { slug: 'in', re: String.raw`Instru[çc][ãa]o\s+Normativa`, name: 'Instrução Normativa' },
  { slug: 'ec', re: String.raw`Emenda\s+Constitucional`, name: 'Emenda Constitucional' },
  { slug: 'mp', re: String.raw`Medida\s+Provis[óo]ria`, name: 'Medida Provisória' },
];
// Tipo, qualificadores ("Estadual", "CNJ", "do CONAMA", "RFB", "n.º"), número com ou sem ponto, ano ("/2020" ou ", de
// 29/12/2003") e o órgão logo depois ("do Conselho Nacional de Justiça").
const QUALIFIER = String.raw`Estadual|Federal|Municipal|Conjunta|(?:d[oa]\s+)?[A-Z][A-Z0-9]{1,11}(?:[/-][A-Z]{2,})?`;
const CITATION = new RegExp(String.raw`(${KINDS.map((k) => k.re).join('|')})((?:\s+(?:${QUALIFIER}))*)\s*(?:n\.?\s*[º°o]?\.?\s*)?(\d{1,3}(?:\.\d{3})+|\d{1,6})(?:\s*\/\s*(\d{2,4})|,?\s+de\s+\d{1,2}[./]\d{1,2}[./](\d{4})|,?\s+de\s+\d{1,2}\s+de\s+[a-zç]+\s+de\s+(\d{4}))?((?:\s+d[oa]\s+(?:[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ú]*|de|da|do|e)(?:\s+(?:[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ú]*|de|da|do|e))*))?`, 'g');

const kindOf = (s: string) => KINDS.find((k) => new RegExp(`^(?:${k.re})$`, 'i').test(s.trim()))!;
export const kindName = (slug: string) => KINDS.find((k) => k.slug === slug)?.name ?? slug;
// Como a norma aparece nos textos: o tipo e, até 40 caracteres depois, o número (com ou sem ponto de milhar). Com a sigla
// do órgão, ela precisa aparecer perto ("Resolução CONAMA 237" e "Resolução nº 237 do CONAMA"; não a "Resolução CNJ 237").
export function normPattern(slug: string, num: string, acronym = '') {
  const re = KINDS.find((k) => k.slug === slug)?.re ?? slug;
  const numRe = num.length > 3 ? `${num.slice(0, -3)}\\.?${num.slice(-3)}` : num;
  return String.raw`(?:${re})${acronym ? String.raw`(?=[^\n]{0,60}?\b${acronym}\b)` : ''}[^\d\n]{0,40}?${numRe}\b`;
}
// Sigla do órgão entre os qualificadores ("RFB" em "Instrução Normativa RFB nº"); "Estadual" e afins não contam.
const acronymOf = (q: string) => [...q.matchAll(/\b([A-Z][A-Z0-9]{1,11})\b/g)].map((m) => m[1]!).filter((a) => !/^(?:RDC|SEI)$/.test(a)).at(-1) ?? '';
const year4 = (y?: string) => (!y ? '' : y.length === 2 ? (Number(y) > 50 ? '19' : '20') + y : y);

export function unlistedNorms(text: string, extra: LawEntry[] = []): UnlistedNorm[] {
  const out = new Map<string, UnlistedNorm>();
  const known = [...LAWS, ...extra];
  for (const m of text.matchAll(CITATION)) {
    const kind = kindOf(m[1]!);
    if (!kind) continue;
    const num = m[3]!.replace(/\./g, ''), year = year4(m[4] ?? m[5] ?? m[6]);
    if (known.some((l) => new RegExp(l.match.source, 'i').test(m[0]))) continue;
    // Número curto sem ano costuma ser outra coisa ("Lei 1", "Res. 2" de uma lista): só com ano ou com 3+ dígitos.
    if (!year && num.length < 3) continue;
    // Normas de órgão (resolução, portaria, instrução normativa, provimento) se repetem de órgão para órgão: a sigla entra
    // na chave e no padrão. Leis e decretos não.
    const acr = ['res', 'port', 'in', 'prov'].includes(kind.slug) ? acronymOf(m[2] ?? '') : '';
    const key = `${kind.slug}-${acr ? acr.toLowerCase() + '-' : ''}${num}${year ? '-' + year : ''}`;
    const pattern = normPattern(kind.slug, num, acr);
    const org = (m[7] ?? '').trim();
    const citation = `${kind.name}${acr ? ' ' + acr : ''} ${num.length > 3 ? Number(num).toLocaleString('pt-BR').replace(/\s/g, '.') : num}${year ? '/' + year : ''}${org ? ' ' + org : ''}`;
    // A mesma norma citada com e sem ano: fica a com ano (chave mais específica).
    const twin = [...out.values()].find((u) => u.pattern === pattern);
    if (twin && (twin.key.split('-').length >= key.split('-').length)) continue;
    if (twin) out.delete(twin.key);
    const q = m[2] ?? '', scope = /Estadual/i.test(q) ? 'estadual' : /Federal/i.test(q) ? 'federal' : '';
    out.set(key, { key, citation: citation.slice(0, 160), pattern, kind: kind.slug, num, year, scope, org: acr || org.replace(/^d[oa]\s+/, '') });
  }
  return [...out.values()];
}

// Onde começam as citações de normas fora do registro: limitam os artigos de cada lei citada antes delas
// ("Lei 6.830 (artigos 1º; 2º); Resolução 354 (artigos 8º a 10)": o 8 a 10 é da Resolução, não da Lei 6.830).
export function unlistedStarts(text: string, extra: LawEntry[] = []): number[] {
  const known = [...LAWS, ...extra];
  return [...text.matchAll(CITATION)].filter((m) => !known.some((l) => new RegExp(l.match.source, 'i').test(m[0]))).map((m) => m.index!);
}

// Norma enviada pelo estudante (linha de legal_norms com owner_id) como entrada de registro.
export interface OwnNormRow { law_key: string; short_name: string; name: string; urn: string; match_pattern: string | null }
export function ownLawEntry(r: OwnNormRow): LawEntry | null {
  if (!r.match_pattern) return null;
  try { return { key: r.law_key, short: r.short_name, name: r.name, urn: r.urn, match: new RegExp(r.match_pattern, 'i') }; } catch { return null; }
}
export const uploadUrn = (ownerId: string, key: string) => `upload:${ownerId}:${key}`;
// Nome curto para citar ("Resolução 354/2020"), sem o órgão.
export const shortCitation = (citation: string) => citation.replace(/\s+d[oa]\s+.*$/, '');
