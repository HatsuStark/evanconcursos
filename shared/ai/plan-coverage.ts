// Cobertura de artigos do cronograma. A IA escolhe os artigos de cada sessão, e a correção das sessões (repairSessions)
// só garante que todo TÓPICO do edital caiu numa sessão: "Lei 12.153/2009" (a lei toda) podia virar uma sessão só dos
// arts. 2º a 8º, e "CPC, arts. 188 a 275" podia perder os arts. 233 a 237 entre duas sessões. Aqui se compara o que o
// edital pede, artigo por artigo (texto oficial no banco), com o que as sessões cobrem, e o que falta entra na sessão
// mais próxima da mesma lei. Usado na montagem (plan-design) e no conserto dos planos já gravados (scripts/plan-coverage.ts).
import { findLawRefs, inRanges, mergeLawRefs, rangesLabel, type ArticleRange, type LawRef } from '../legal/refs.ts';
import { lawByKey, type LawEntry } from '../legal/registry.ts';

// Artigo do texto oficial (legal_articles), na ordem da lei.
export interface LawArticle { num: number; suffix: string; revoked: boolean }
// O que um tópico do edital pede de uma lei. ranges vazio = a lei inteira.
export interface RequiredLaw { law: string; topic: number; ranges: ArticleRange[] }
export interface ArticleGap { law: string; topic: number; ranges: ArticleRange[] }

// Lei inteira só quando o tópico é só a citação dela ("3.3. Lei n.º 12.153 de 22/12/2009."). "Constituição Federal:
// princípios fundamentais" ou "Lei 8.112/90: regime disciplinar" pedem um assunto, não a lei toda.
const FILLER = /\b(n[º°o.]*|de|da|do|das|dos|e|lei|leis|federal|estadual|complementar|decreto|ordinária|suas|alterações|posteriores|atualizad[ao]s?|vigente|redação|dada|pela|texto|integral|na|no|com)\b/gi;
export function isBareLawTopic(text: string, law: LawEntry) {
  if (/\bart(s?\.|igos?)/i.test(text) || !new RegExp(law.match.source, 'i').test(text)) return false;
  let rest = text.replace(new RegExp(law.match.source, 'gi'), ' ');
  for (const w of law.name.split(/\s+/).filter((x) => x.length >= 3)) rest = rest.replace(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), ' ');
  const words = rest.replace(FILLER, ' ').replace(/[\d\W_]+/g, ' ').split(' ').filter((w) => w.length >= 3);
  return words.length <= 1;
}

// O que cada tópico pede: artigos citados (faixas) ou a lei inteira (tópico que é só a lei).
export function requiredLaws(topics: string[], subject: string, extra: LawEntry[] = []): RequiredLaw[] {
  return topics.flatMap((text, topic) => findLawRefs(text, subject, extra).flatMap((r) => {
    if (r.ranges.length) return [{ law: r.law, topic, ranges: r.ranges }];
    const law = lawByKey(r.law, extra);
    return law && isBareLawTopic(text, law) ? [{ law: r.law, topic, ranges: [] }] : [];
  }));
}

// Artigos vigentes pedidos e que nenhuma sessão cobre, em faixas. Revogado no meio não quebra a faixa (não há o que ler
// nele); artigo coberto quebra. Sessão com a lei sem faixa (lei inteira) cobre tudo dela.
export function articleGaps(required: (RequiredLaw & { articles: LawArticle[] })[], sessions: { refs?: LawRef[] | null }[]): ArticleGap[] {
  const out: ArticleGap[] = [];
  const seen = new Set<string>();
  for (const req of required) {
    const refs = sessions.flatMap((s) => (s.refs ?? []).filter((r) => r.law === req.law));
    const covered = (a: LawArticle) => refs.some((r) => inRanges(r.ranges, a.num, a.suffix));
    let run: { first: LawArticle; last: LawArticle } | null = null;
    const ranges: ArticleRange[] = [];
    const close = () => {
      if (!run) return;
      ranges.push({ from: run.first.num, to: run.last.num, ...(run.first.suffix ? { fromSuffix: run.first.suffix } : {}), ...(run.last.suffix ? { toSuffix: run.last.suffix } : {}) });
      run = null;
    };
    for (const a of req.articles) {
      if (!inRanges(req.ranges, a.num, a.suffix)) continue;
      const key = `${req.law}:${a.num}${a.suffix}`;
      if (a.revoked) continue;
      if (covered(a) || seen.has(key)) { close(); continue; }
      seen.add(key);
      if (run) run.last = a; else run = { first: a, last: a };
    }
    close();
    if (ranges.length) out.push({ law: req.law, topic: req.topic, ranges });
  }
  return out;
}

// Distância entre a faixa que falta e as faixas de uma sessão (0 = encostadas ou sobrepostas).
function distance(gap: ArticleRange, ranges: ArticleRange[]) {
  return Math.min(...ranges.map((r) => (gap.from > r.to ? gap.from - r.to : gap.to < r.from ? r.from - gap.to : 0)));
}

export interface GapFix { index: number; law: string; ranges: ArticleRange[]; before: string; after: string }

// Põe cada faixa que falta na sessão mais próxima da mesma lei (pelos números dos artigos; empate, a anterior), entre as
// que `eligible` aceita (ex.: só sessões ainda não estudadas). Sem sessão da lei: a que tem o tópico; sem ela, a última
// aceita. A sessão ganha a faixa nos refs, a citação no título (para a lei seca, a apostila e as questões) e o tópico.
// `topicBase`: 1 quando os tópicos das sessões são os números da IA (1-based), 0 quando já são índices.
export function fillArticleGaps<T extends { title: string; topics: number[]; refs?: LawRef[] | null }>(
  list: T[], gaps: ArticleGap[], cite: (law: string) => string, opts: { topicBase?: number; eligible?: (s: T, i: number) => boolean } = {},
): { sessions: T[]; fixes: GapFix[] } {
  const base = opts.topicBase ?? 0, ok = (s: T, i: number) => opts.eligible?.(s, i) ?? true;
  const sessions = list.map((s) => ({ ...s }));
  const add = new Map<number, Map<string, { ranges: ArticleRange[]; topics: Set<number> }>>();
  for (const g of gaps) {
    for (const range of g.ranges) {
      let best = -1, bestD = Infinity;
      sessions.forEach((s, i) => {
        if (!ok(s, i)) return;
        const own = (s.refs ?? []).filter((r) => r.law === g.law && r.ranges.length).flatMap((r) => r.ranges);
        if (!own.length) return;
        const d = distance(range, own);
        if (d < bestD) { best = i; bestD = d; }
      });
      if (best < 0) best = sessions.findIndex((s, i) => ok(s, i) && s.topics.includes(g.topic + base));
      if (best < 0) for (let i = sessions.length - 1; i >= 0 && best < 0; i--) if (ok(sessions[i]!, i)) best = i;
      if (best < 0) continue;
      const byLaw = add.get(best) ?? new Map();
      const cur = byLaw.get(g.law) ?? { ranges: [], topics: new Set<number>() };
      cur.ranges.push(range); cur.topics.add(g.topic + base);
      byLaw.set(g.law, cur); add.set(best, byLaw);
    }
  }
  const fixes: GapFix[] = [];
  for (const [i, byLaw] of [...add].sort((a, b) => a[0] - b[0])) {
    const s = sessions[i]!, before = s.title;
    let title = s.title, refs = s.refs ?? [], topics = [...s.topics];
    for (const [law, { ranges, topics: ts }] of byLaw) {
      const sorted = [...ranges].sort((a, b) => a.from - b.from);
      title = `${title}; ${cite(law)}, ${rangesLabel({ law, ranges: sorted })}`;
      refs = mergeLawRefs(refs, [{ law, ranges: sorted }]);
      topics = [...new Set([...topics, ...ts])].sort((a, b) => a - b);
      fixes.push({ index: i, law, ranges: sorted, before, after: '' });
    }
    // Título cabe em 200 caracteres (limite da IA e do banco é 300); os refs guardam a lista completa.
    sessions[i] = { ...s, title: title.slice(0, 200), refs, topics };
    for (const f of fixes) if (f.index === i) f.after = sessions[i]!.title;
  }
  return { sessions, fixes };
}

// Como citar a lei num título para findLawRefs achá-la de novo: a sigla, se o registro a reconhece; senão o nome.
export const lawCite = (key: string, extra: LawEntry[] = []) => {
  const law = lawByKey(key, extra);
  if (!law) return key;
  return new RegExp(law.match.source, 'i').test(law.short) ? law.short : law.name;
};
