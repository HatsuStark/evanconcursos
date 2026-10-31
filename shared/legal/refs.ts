// Encontra referências a leis e artigos em textos livres (títulos de sessão, tópicos do edital):
// "CP, arts. 327 e 312 a 315", "Código de Processo Penal - artigos 251 a 258; 261 a 267",
// "Lei n.º 9.099 de 26.09.1995 (artigos 60 a 83; 88 e 89)", "art. 5º da CF".
import { LAWS, lawForSubject } from './registry.ts';

export interface ArticleRange { from: number; to: number; fromSuffix?: string; toSuffix?: string }
export interface LawRef { law: string; ranges: ArticleRange[] } // ranges vazio = a lei toda / sem artigo citado

const NUM = String.raw`(\d{1,3}(?:\.\d{3})*)\s*(?:º|°)?(?:\s*-\s*([A-Z]{1,2})\b)?`;
const num = (s: string) => Number(s.replace(/\./g, ''));

// Intervalos a partir de "293 a 305; 307; 308; 311-A; 312 a 317 e 319".
export function parseRanges(s: string): ArticleRange[] {
  const out: ArticleRange[] = [];
  const re = new RegExp(`${NUM}(?:\\s*(?:a|até|ao|-)\\s*${NUM})?`, 'g');
  for (const m of s.matchAll(re)) {
    const from = num(m[1]!), to = m[3] ? num(m[3]) : from;
    if (!from || to < from || to - from > 2000) continue;
    out.push({ from, to, ...(m[2] ? { fromSuffix: m[2] } : {}), ...(m[4] ? { toSuffix: m[4] } : {}) });
  }
  return out;
}

// Trecho de artigos logo depois da menção à lei (ou "arts. X da CF", antes dela).
const ART_LIST = String.raw`\b(?:arts?\.|artigos?)\s*((?:${NUM}(?:\s*(?:,|;|e|a|até|ao|-)\s*)?)+)`;

export function findLawRefs(text: string, subject = ''): LawRef[] {
  const found = new Map<string, ArticleRange[]>();
  const add = (law: string, ranges: ArticleRange[]) => found.set(law, [...(found.get(law) ?? []), ...ranges]);
  // Posições de cada menção a lei.
  const mentions: { law: string; start: number; end: number }[] = [];
  for (const l of LAWS) {
    const re = new RegExp(l.match.source, 'gi');
    for (const m of text.matchAll(re)) mentions.push({ law: l.key, start: m.index!, end: m.index! + m[0].length });
  }
  mentions.sort((a, b) => a.start - b.start);
  // Menções sobrepostas (ex.: "Código de Processo Penal" contém "Código ... Penal"): fica a mais longa.
  const kept = mentions.filter((m, i) => !mentions.some((o, j) => j !== i && o.start <= m.start && o.end >= m.end && (o.end - o.start) > (m.end - m.start)));
  kept.forEach((m, i) => {
    const next = kept[i + 1]?.start ?? text.length;
    const after = text.slice(m.end, next), before = text.slice(Math.max(0, (kept[i - 1]?.end ?? 0)), m.start);
    // "art. 5º da CF": artigos imediatamente antes da menção.
    const tail = new RegExp(`${ART_LIST}\\s*(?:da|do|de)\\s*$`, 'i');
    let a = new RegExp(ART_LIST, 'i').exec(after);
    // "art. 121 do CP e art. 5º da CF": o 5º logo depois do CP pertence à CF.
    if (a && i + 1 < kept.length && tail.exec(after)?.index === a.index) a = null;
    const b = tail.exec(before);
    add(m.law, [...(b ? parseRanges(b[1]!) : []), ...(a ? parseRanges(a[1]!) : [])]);
  });
  // Sem lei citada: artigos soltos ("arts. 4º a 23") vão para a lei principal da matéria.
  if (!found.size) {
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
