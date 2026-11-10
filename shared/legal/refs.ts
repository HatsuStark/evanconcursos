// Encontra referências a leis e artigos em textos livres (títulos de sessão, tópicos do edital):
// "CP, arts. 327 e 312 a 315", "Código de Processo Penal - artigos 251 a 258; 261 a 267",
// "Lei n.º 9.099 de 26.09.1995 (artigos 60 a 83; 88 e 89)", "art. 5º da CF".
import { unlistedNorms, unlistedStarts } from './norms.ts';
import { LAWS, lawForSubject, type LawEntry } from './registry.ts';

export interface ArticleRange { from: number; to: number; fromSuffix?: string; toSuffix?: string }
export interface LawRef { law: string; ranges: ArticleRange[] } // ranges vazio = a lei toda / sem artigo citado

const NUM = String.raw`(\d{1,4}(?:\.\d{3})*)(?:\s*(?:º|°))?(?:\s*-\s*([A-Z]{1,2})\b)?`;
const num = (s: string) => Number(s.replace(/\./g, ''));

// Quantos artigos o texto cita ("arts. 1º e 8º a 10" → 4), de qualquer norma: estimativa do tamanho quando não há texto.
export function citedArticleCount(text: string) {
  return [...text.matchAll(ART_LIST_RE)].flatMap((m) => parseRanges(m[1]!)).reduce((a, r) => a + Math.min(r.to - r.from + 1, 200), 0);
}

// Intervalos a partir de "293 a 305; 307; 308; 311-A; 312 a 317 e 319".
export function parseRanges(s: string): ArticleRange[] {
  const out: ArticleRange[] = [];
  s = s.replace(DEVICE_RE, ' '); // "§ 1º" não é o art. 1º
  const re = new RegExp(`${NUM}(?:\\s*(?:a|até|ao|-)\\s*${NUM})?`, 'g');
  for (const m of s.matchAll(re)) {
    const from = num(m[1]!), to = m[3] ? num(m[3]) : from;
    if (!from || to < from || to - from > 2000) continue;
    out.push({ from, to, ...(m[2] ? { fromSuffix: m[2] } : {}), ...(m[4] ? { toSuffix: m[4] } : {}) });
  }
  return out;
}

// Trecho de artigos logo depois da menção à lei (ou "arts. X da CF", antes dela). O separador é obrigatório entre
// os números: opcional, a regex tenta todas as divisões da lista e leva minutos em listas longas de edital.
const SEP = String.raw`\s*(?:,\s*e\b|,|;|e|a|até|ao|-)`;
// Dispositivo dentro do artigo ("196, XX", "282, § 1º", "inciso II", "parágrafo único", "alínea b"): o artigo entra
// inteiro e a lista continua ("arts. 196, XX, 282, § 1º, 310" = arts. 196, 282 e 310). Começa por letra ou §, nunca por
// dígito, para não disputar com o número seguinte da lista.
const DEVICE = String.raw`(?:§+\s*\d{1,3}\s*(?:º|°)?|par[áa]grafo\s+[úu]nico|p\.\s*[úu]\.|caput|inc(?:iso)?s?\.?\s*[IVXLC]{1,7}\b|(?<![-\w])[IVXLC]{1,7}(?=\s*(?:[,;)]|e\s|$))|al[íi]neas?\s*["“]?[a-z]\b["”]?)`;
const QUAL = String.raw`(?:\s*,?\s*${DEVICE})*`;
const ART_LIST = String.raw`\b(?:arts?\.|artigos?)\s*(${NUM}${QUAL}(?:${SEP}\s*${NUM}${QUAL})*(?:${SEP})?)`;
// Compiladas uma vez: o cronograma mede milhares de títulos (citedArticleCount) ao distribuir os dias.
const ART_LIST_RE = new RegExp(ART_LIST, 'gi'), DEVICE_RE = new RegExp(DEVICE, 'gi');

// Cita lei fora do registro (ex.: estadual)? Então os artigos do texto são dela, não de outra lei conhecida.
// `extra`: normas enviadas pelo estudante (PDF), que valem como leis do registro para ele.
export function citesUnlistedLaw(text: string, extra: LawEntry[] = []) {
  return unlistedNorms(text, extra).length > 0;
}

export function findLawRefs(text: string, subject = '', extra: LawEntry[] = []): LawRef[] {
  const found = new Map<string, ArticleRange[]>();
  const add = (law: string, ranges: ArticleRange[]) => found.set(law, [...(found.get(law) ?? []), ...ranges]);
  // Posições de cada menção a lei.
  const mentions: { law: string; start: number; end: number }[] = [];
  for (const l of [...LAWS, ...extra]) {
    const re = new RegExp(l.match.source, 'gi');
    for (const m of text.matchAll(re)) mentions.push({ law: l.key, start: m.index!, end: m.index! + m[0].length });
  }
  mentions.sort((a, b) => a.start - b.start);
  // Menções sobrepostas (ex.: "Código de Processo Penal" contém "Código ... Penal"): fica a mais longa.
  const kept = mentions.filter((m, i) => !mentions.some((o, j) => j !== i && o.start <= m.start && o.end >= m.end && (o.end - o.start) > (m.end - m.start)));
  // Os artigos de uma lei vão até a próxima norma citada, do registro ou não.
  const others = unlistedStarts(text, extra);
  kept.forEach((m, i) => {
    const next = Math.min(kept[i + 1]?.start ?? text.length, ...others.filter((o) => o >= m.end));
    const after = text.slice(m.end, next), before = text.slice(Math.max(0, (kept[i - 1]?.end ?? 0)), m.start);
    // "art. 5º da CF": artigos imediatamente antes da menção.
    const tail = new RegExp(`${ART_LIST}\\s*(?:da|do|de)\\s*$`, 'i');
    // Todas as listas do trecho ("Cap. I, arts. 1º a 4º; Cap. III, arts. 33, 47 e 49"), menos a que fecha o trecho
    // apontando a lei seguinte ("art. 121 do CP e art. 5º da CF": o 5º é da CF).
    const lastTail = i + 1 < kept.length && next === kept[i + 1]!.start ? tail.exec(after)?.index : undefined;
    const lists = [...after.matchAll(new RegExp(ART_LIST, 'gi'))].filter((x) => x.index !== lastTail);
    const b = tail.exec(before);
    add(m.law, [...(b ? parseRanges(b[1]!) : []), ...lists.flatMap((x) => parseRanges(x[1]!))]);
  });
  // Sem lei citada: artigos soltos ("arts. 4º a 23") vão para a lei principal da matéria.
  if (!found.size && !citesUnlistedLaw(text, extra)) {
    const law = lawForSubject(subject), a = new RegExp(ART_LIST, 'i').exec(text);
    if (law) add(law, a ? parseRanges(a[1]!) : []);
  }
  return [...found].map(([law, ranges]) => ({ law, ranges: dedupe(ranges) }));
}

// Leis de um edital: as citadas nos tópicos e a principal de cada matéria (sessões sem citação usam essa).
export function noticeLawKeys(subjects: { name: string; topics: string[] }[]) {
  return new Set(subjects.flatMap((s) => {
    const main = lawForSubject(s.name);
    return [...findLawRefs(s.topics.join('\n'), s.name).map((r) => r.law), ...(main ? [main] : [])];
  }));
}

function dedupe(r: ArticleRange[]) {
  const seen = new Set<string>();
  return r.filter((x) => { const k = `${x.from}${x.fromSuffix ?? ''}-${x.to}${x.toSuffix ?? ''}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// O artigo (num + sufixo) está em algum dos intervalos? Sem intervalos = a lei toda.
export function inRanges(ranges: ArticleRange[], n: number, suffix = ''): boolean {
  if (!ranges.length) return true;
  return ranges.some((r) => {
    if (n < r.from || n > r.to) return false;
    if (n === r.from && r.fromSuffix && suffix < r.fromSuffix) return false;
    if (n === r.to && r.to !== r.from && suffix && !r.toSuffix) return false;
    if (r.from === r.to) return r.fromSuffix ? suffix === r.fromSuffix : true;
    return true;
  });
}

// Artigos de lei de uma sessão. O título manda; o item do edital (que costuma juntar várias leis de várias sessões) só
// completa quando bate com ele:
// - título com artigos de lei conhecida: só eles;
// - título que cita artigos de uma norma fora do registro, ou lei não listada: nada do item (senão a sessão "Normas da CGJ
//   (arts. 1º a 4º)" recebia a Lei 6.830, a primeira do item);
// - título que nomeia a lei sem artigos ("Lei Maria da Penha: medidas protetivas"): os artigos dessa lei no item;
// - título sem lei: o item só vale se tiver uma lei só.
export function sessionLawRefs(title: string, topics: string[], subject = '', extra: LawEntry[] = []): LawRef[] {
  const inTitle = findLawRefs(title, subject, extra);
  const withArts = inTitle.filter((r) => r.ranges.length);
  if (withArts.length) return withWholeTitleLaws(withArts, title, extra);
  if (citesUnlistedLaw(title, extra) || new RegExp(ART_LIST, 'i').test(title)) return [];
  const fromTopics = findLawRefs(topics.join('\n'), subject, extra).filter((r) => r.ranges.length);
  if (inTitle.length) return fromTopics.filter((r) => inTitle.some((t) => t.law === r.law));
  return fromTopics.length === 1 ? fromTopics : [];
}

// "arts. 105 a 110, 994", "art. 5" ou "lei completa".
// Números com ponto de milhar e sufixo ("1.091-A"), como no texto da lei, para o título voltar a apontar os mesmos artigos.
const artLabel = (n: number, suffix?: string) => `${n.toLocaleString('pt-BR').replace(/\s/g, '.')}${suffix ? '-' + suffix : ''}`;
export const rangesLabel = (r: LawRef) => r.ranges.length
  ? (r.ranges.length === 1 && r.ranges[0]!.from === r.ranges[0]!.to && r.ranges[0]!.fromSuffix === r.ranges[0]!.toSuffix ? 'art. ' : 'arts. ')
    + r.ranges.map((x) => x.from === x.to && x.fromSuffix === x.toSuffix ? artLabel(x.from, x.fromSuffix) : `${artLabel(x.from, x.fromSuffix)} a ${artLabel(x.to, x.toSuffix)}`).join(', ')
  : 'lei completa';

// Filtro PostgREST (.or) só com os intervalos citados. Buscar do menor ao maior artigo trazia o meio todo, e o limite de
// linhas cortava o fim: "arts. 196, ..., 439 a 440-A, 1.137 a 1.139, 1.245 e 1.247" das Normas da CGJ são 1.216 artigos
// de 196 a 1.247, e a apostila recebia só até o 315. Sufixos ("436-A") são conferidos depois, com inRanges.
export function rangesOrFilter(ranges: ArticleRange[]) {
  return [...new Set(ranges.map((r) => (r.from === r.to ? `num.eq.${r.from}` : `and(num.gte.${r.from},num.lte.${r.to})`)))].join(',');
}

// ---------- artigos estruturados da sessão ----------
// Na montagem do plano, a IA devolve, junto com o título, a lei e a lista de artigos de cada sessão. O app grava isso na
// sessão (study_sessions.law_refs), e a lei seca, a apostila e as questões buscam os artigos por esse campo, sem reler o
// título. Sessões de planos antigos (sem o campo) continuam usando sessionLawRefs.

// Junta listas de artigos por lei, sem repetir intervalos.
export function mergeLawRefs(...lists: (LawRef[] | null | undefined)[]): LawRef[] {
  const by = new Map<string, ArticleRange[]>();
  for (const r of lists.flat()) if (r) by.set(r.law, [...(by.get(r.law) ?? []), ...r.ranges]);
  return [...by].map(([law, ranges]) => ({ law, ranges: dedupe(ranges) }));
}

// Resposta da IA ({ law: 'NSCGJ', articles: '196, 282, 436-A, 1º a 4º' }) → intervalos. Só leis do registro (ou enviadas
// pelo estudante) e com artigos: norma que o app não tem, ou lei sem artigo, fica de fora.
export function aiLawRefs(laws: { law: string; articles: string }[] | undefined, extra: LawEntry[] = []): LawRef[] {
  const known = [...LAWS, ...extra];
  return mergeLawRefs((laws ?? []).flatMap((l) => {
    const key = l.law.trim(), law = known.find((k) => k.key === key) ?? known.find((k) => k.key.toLowerCase() === key.toLowerCase());
    const ranges = law ? parseRanges(l.articles ?? '') : [];
    return law && ranges.length ? [{ law: law.key, ranges }] : [];
  }));
}

// Valor de study_sessions.law_refs conferido; vazio ou fora do formato → null (vale a leitura do título).
export function storedLawRefs(v: unknown): LawRef[] | null {
  if (!Array.isArray(v)) return null;
  const ok = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n > 0;
  const sfx = (s: unknown) => (typeof s === 'string' && /^[A-Z]{1,2}$/.test(s) ? s : undefined);
  const out = v.flatMap((r) => {
    if (!r || typeof r.law !== 'string' || !Array.isArray(r.ranges)) return [];
    const ranges: ArticleRange[] = r.ranges.filter((x: ArticleRange) => x && ok(x.from) && ok(x.to) && x.to >= x.from)
      .map((x: ArticleRange) => ({ from: x.from, to: x.to, ...(sfx(x.fromSuffix) ? { fromSuffix: sfx(x.fromSuffix) } : {}), ...(sfx(x.toSuffix) ? { toSuffix: sfx(x.toSuffix) } : {}) }));
    return ranges.length ? [{ law: r.law, ranges }] : [];
  });
  return out.length ? out : null;
}

// Leis que o título nomeia sem citar artigo ("Lei SP 11.608/2003 e NSCGJ, arts. 1º a 4º") e que não estão na lista:
// entram inteiras (ranges vazio). A montagem só grava lei com artigos, e sem isto a lei curta citada por inteiro sumia
// da lei seca e da apostila. Sem a matéria: a lei principal dela não entra por falta de lei no título.
export function withWholeTitleLaws(refs: LawRef[], title: string, extra: LawEntry[] = []): LawRef[] {
  const whole = findLawRefs(title, '', extra).filter((r) => !r.ranges.length && !refs.some((x) => x.law === r.law));
  return whole.length ? [...refs, ...whole] : refs;
}

// Artigos de lei da sessão: os gravados na montagem; sem eles (plano antigo), os lidos do título. Mais as leis que o
// título nomeia sem artigo, inteiras (quem usa decide se a lei é curta o bastante para entrar toda).
export function resolveSessionRefs(stored: unknown, title: string, topics: string[], subject = '', extra: LawEntry[] = []): LawRef[] {
  const stored2 = storedLawRefs(stored);
  return stored2 ? withWholeTitleLaws(stored2, title, extra) : sessionLawRefs(title, topics, subject, extra);
}
