// Artigos que vão para a IA quando a sessão cita mais do que cabe (MAX_ARTICLES). Os primeiros N cortariam os assuntos do
// fim do título (ex.: "Juiz, MP, …, citação, nulidades, tutela provisória" parava no art. 189). Aqui, cada seção da lei
// (capítulo ou título, pelo `heading`) garante o seu primeiro artigo, que costuma trazer a regra geral; as vagas que
// sobram vão para as seções que o título da sessão cita e que a banca mais cobra (incidência por assunto, já medida para
// as questões). Sem custo de IA nem de API: só cruza nomes.

// hot: está entre os mais cobrados (levantamento da IA): a seção ganha peso e o artigo entra antes dos vizinhos.
export interface SelectableArticle { label: string; num: number; suffix: string; text: string; heading?: string; hot?: boolean }
export interface Incidence { assunto: string; total: number }

const STOP = new Set(['da', 'das', 'de', 'do', 'dos', 'e', 'em', 'na', 'nas', 'no', 'nos', 'a', 'o', 'as', 'os', 'para', 'por', 'com', 'sem', 'ou', 'cpc', 'lei', 'arts', 'art', 'parte', 'geral', 'gerais', 'disposicoes', 'capitulo', 'titulo', 'secao', 'livro', 'processo', 'processual', 'direito', 'civil', 'penal']);
const words = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
  .filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w) && !/^[ivxlc]+$/.test(w));
// "nulidades" ~ "nulidade", "citação" ~ "citacao": mesmo começo (até 6 letras).
const stem = (w: string) => w.slice(0, Math.min(6, w.length));
const overlaps = (a: Set<string>, b: Set<string>) => [...a].some((x) => b.has(x));

// Só as duas últimas partes do heading: "PARTE GERAL › LIVRO IV" diria que tudo é do mesmo assunto.
const sectionStems = (heading: string) => new Set(words(heading.split('›').slice(-2).join(' ')).map(stem));

export function selectArticles<T extends SelectableArticle>(arts: T[], max: number, ctx: { title: string; topics?: string[]; incidence?: Incidence[] } = { title: '' }): { picked: T[]; omitted: string[] } {
  if (arts.length <= max) return { picked: arts, omitted: [] };
  // Seções na ordem da lei; artigo sem heading forma a sua própria seção com os vizinhos sem heading.
  const sections: { name: string; items: number[]; score: number; taken: number }[] = [];
  arts.forEach((a, i) => {
    const name = a.heading ?? '', last = sections[sections.length - 1];
    if (last && last.name === name) last.items.push(i); else sections.push({ name, items: [i], score: 1, taken: 0 });
  });
  // Dentro da seção: o primeiro artigo (regra geral), depois os mais cobrados, depois os demais na ordem.
  for (const s of sections) s.items = [s.items[0]!, ...s.items.slice(1).filter((i) => arts[i]!.hot), ...s.items.slice(1).filter((i) => !arts[i]!.hot)];
  // Título antes dos artigos ("Juiz, MP, citação…: CPC arts. …") e tópicos do edital, cada trecho separado por vírgula.
  const asked = [ctx.title.split(':')[0] ?? '', ...(ctx.topics ?? [])].join(',').split(/[,;]| e /).map((x) => new Set(words(x).map(stem))).filter((x) => x.size);
  const inc = (ctx.incidence ?? []).filter((x) => x.total > 0).map((x) => ({ stems: new Set(words(x.assunto).map(stem)), total: x.total }));
  const top = Math.max(1, ...inc.map((x) => x.total));
  for (const s of sections) {
    const st = sectionStems(s.name);
    if (asked.some((a) => overlaps(a, st))) s.score += 2;
    // Cobrança da banca: até +4 para o assunto mais cobrado da sessão.
    s.score += 4 * Math.max(0, ...inc.filter((x) => overlaps(x.stems, st)).map((x) => x.total / top));
    // Mais cobrados segundo a IA: +1,5 por artigo da seção na lista, até +4,5.
    s.score += Math.min(4.5, 1.5 * s.items.filter((i) => arts[i]!.hot).length);
  }
  const take = new Set<number>();
  // 1º: o primeiro artigo de cada seção, das mais importantes para as menos, enquanto houver vaga.
  for (const s of [...sections].sort((a, b) => b.score - a.score)) {
    if (take.size >= max) break;
    take.add(s.items[0]!); s.taken = 1;
  }
  // 2º: as vagas que sobram, uma a uma, para a seção com mais peso por artigo já tomado (na ordem dos artigos dela).
  while (take.size < max) {
    const open = sections.filter((s) => s.taken > 0 && s.taken < s.items.length);
    if (!open.length) break;
    const s = open.reduce((m, x) => (x.score / (x.taken + 1) > m.score / (m.taken + 1) ? x : m));
    take.add(s.items[s.taken]!); s.taken++;
  }
  const omitted = sections.filter((s) => !s.taken).map((s) => s.name.split('›').pop()!.trim()).filter(Boolean);
  return { picked: arts.filter((_, i) => take.has(i)), omitted };
}
