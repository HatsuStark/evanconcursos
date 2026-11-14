// Liga o edital ao banco de questões: matéria do edital → matéria da API (por matéria) e
// sessão do cronograma → assuntos da API (por sessão). Determinístico quando dá; IA nos casos ambíguos,
// sempre escolhendo dentro das listas oficiais da API (nunca inventa nome de matéria ou assunto).
import { z } from 'zod';
import { normalizeText } from '../ai/notice.ts';
import { findLawRefs } from '../legal/refs.ts';
import { lawByKey } from '../legal/registry.ts';
import { fullMaterias, genericSubject, subjectMateria } from './materias.ts';
import { organSearch, placeFilter } from './places.ts';

// qmap-v4: o tema da sessão é o foco; o item do edital é só contexto (um item longo, como "Classes de palavras: substantivo,
// adjetivo, …, conjunção", vira várias sessões) e assunto genérico só entra sem um específico do tema.
// qmap-v5: assunto com o nome do tema ("Competência" numa sessão de competência) não conta como genérico.
// qmap-v6: até 8 assuntos em ordem de relevância; a medição fica com os 5 primeiros que têm questões. A IA prefere nomes que
// parecem específicos ("Conceito, Princípios e Regras de Competência", 2 questões) aos que têm volume ("Competência", 159).
export const QMAP_PROMPT_VERSION = 'qmap-v10';
export const SESSION_ASSUNTOS = 5, ASSUNTO_CANDIDATES = 8;
// Matérias achadas pelo tema que concorrem com a da disciplina, e o tamanho mínimo da lista de assuntos para concorrer.
const SESSION_CANDIDATES = 3, HOLLOW_ASSUNTOS = 2;

const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'em', 'no', 'na', 'nos', 'nas', 'para', 'por', 'com', 'ao', 'aos', 'art', 'arts', 'lei', 'nocoes', 'noções']);
// Palavras de título que não nomeiam matéria: a busca por elas traz matérias de qualquer assunto.
const GENERIC_WORDS = new Set(['introducao', 'conceitos', 'fundamentos', 'principios', 'aspectos', 'gerais', 'basicos', 'basicas', 'teoria', 'estudo', 'questoes', 'revisao', 'reforco', 'aplicada', 'aplicadas']);
export const tokens = (s: string) => normalizeText(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w));

// Matéria: igual > contém todas as palavras > sobreposição; penaliza especializações que o edital não pediu.
export function scoreMateria(subject: string, cand: string): number {
  const a = normalizeText(subject).replace(/^(nocoes|conhecimentos) (de|do|da|dos|das|basicos de) /, ''), b = normalizeText(cand);
  if (a === b) return 100;
  const ta = tokens(a), tb = tokens(b);
  const hit = ta.filter((t) => tb.includes(t)).length;
  let s = (hit / Math.max(1, ta.length)) * 70 - Math.max(0, tb.length - ta.length) * 4;
  if (b.startsWith(a)) s += 15;
  for (const w of ['militar', 'trabalho', 'eleitoral', 'tributario', 'internacional', 'ambiental', '1973', 'ensino', 'literatura', 'financeira']) if (b.includes(w) && !a.includes(w)) s -= 30;
  if (b.includes('2015')) s += 5; // CPC vigente
  return s;
}
export function pickMateria(subject: string, candidates: string[]) {
  const ranked = candidates.map((c) => ({ c, s: scoreMateria(subject, c) })).sort((x, y) => y.s - x.s);
  return { best: ranked[0]?.c ?? null, score: ranked[0]?.s ?? 0, ranked: ranked.map((r) => r.c) };
}

// Pré-filtro de assuntos pela sobreposição de palavras com a sessão (a lista de algumas matérias passa de mil).
// focus: tema e palavra-chave da sessão (pesam o dobro); context: item do edital.
// Singular aproximado, para "Elasticidades" casar com "elasticidade" e "funções" com "função" (texto já sem acento).
export const stem = (w: string) => w.replace(/coes$/, 'cao').replace(/oes$/, 'ao').replace(/ais$/, 'al').replace(/eis$/, 'el').replace(/(?<=.{3})s$/, '');
const stems = (s: string) => tokens(s).map(stem);
export const PREFILTER_MAX = 120;
export function prefilterAssuntos(assuntos: string[], focus: string, max = PREFILTER_MAX, context = '') {
  const ft = new Set(stems(focus)), ct = new Set(stems(context));
  if ((!ft.size && !ct.size) || assuntos.length <= max) return assuntos.slice(0, max);
  return assuntos.map((a, i) => ({ a, i, s: stems(a).reduce((n, t) => n + (ft.has(t) ? 2 : ct.has(t) ? 1 : 0), 0) }))
    .sort((x, y) => y.s - x.s || x.i - y.i).slice(0, max).map((x) => x.a);
}

export const MateriaChoice = z.object({
  materia: z.string().describe('Uma das matérias candidatas, exatamente como escrita, ou "" se nenhuma serve.'),
});
export const materiaJsonSchema = () => z.toJSONSchema(MateriaChoice, { target: 'draft-7' });
export function materiaPrompt(subject: string, topics: string[], candidates: string[]) {
  return `Estamos ligando uma disciplina de edital de concurso público a um banco de questões.
Disciplina do edital: ${subject}
Conteúdo (amostra): ${topics.slice(0, 6).join(' | ').slice(0, 900)}
Matérias do banco de questões (escolha uma, exatamente como escrita):
${candidates.map((c) => `- ${c}`).join('\n')}
Escolha a matéria cujas questões melhor cobrem a disciplina. Prefira a geral à especializada (ex.: "Direito Penal" em vez de "Direito Penal Militar") e a versão vigente da lei. Se nenhuma servir, responda "".`;
}

export const AssuntoChoice = z.object({
  assuntos: z.array(z.string()).describe('Até 8 assuntos da lista, exatamente como escritos, do mais ao menos relevante.'),
});
export const assuntoJsonSchema = () => z.toJSONSchema(AssuntoChoice, { target: 'draft-7' });
export function assuntoPrompt(p: { subject: string; materia: string; title: string; keyword: string; topics: string[]; assuntos: string[] }) {
  return `Estamos escolhendo questões de concurso para uma sessão de estudo.
Disciplina: ${p.subject} (no banco de questões: ${p.materia})
Tema da sessão (o foco): ${p.title}
Palavra-chave: ${p.keyword || '—'}
Item do edital de onde o tema saiu (só contexto; pode listar assuntos que são de outras sessões): ${p.topics.join(' | ').slice(0, 1200) || '—'}
Assuntos disponíveis no banco de questões (escolha somente desta lista, exatamente como escritos):
${p.assuntos.map((a) => `- ${a}`).join('\n')}
Escolha até 8 assuntos cujas questões treinam exatamente o TEMA da sessão, do mais ao menos relevante (o app fica com os primeiros que tiverem questões).
- O item do edital costuma ser maior que o tema: ignore o que ele lista fora do tema (ex.: tema "Substantivos e adjetivos" num item que cita todas as classes de palavras não leva pronome, verbo nem conjunção).
- Evite assunto genérico que abrange a matéria ou vários temas (ex.: "Classes de palavras", "Morfologia", "Gramática") quando houver assunto específico do tema; use o genérico só se não houver nenhum específico.
- Assunto com o nome do próprio tema ou de uma parte dele não é genérico: inclua-o (ex.: "Competência" numa sessão sobre competência, "Princípios do Direito Processual Civil" numa sessão sobre os princípios do CPC). Os subassuntos dele entram junto, não no lugar.
- Tema com várias partes (ex.: princípios, cooperação e competência) leva assunto de cada parte.
- Não escolha assuntos de outras partes da matéria. Se nenhum servir, devolva lista vazia.`;
}

// Mantém só escolhas que existem na lista (comparação sem acento/caixa), na forma oficial.
export function keepValid(chosen: string[], list: string[], max = 5) {
  const byNorm = new Map(list.map((a) => [normalizeText(a), a]));
  return [...new Set(chosen.map((c) => byNorm.get(normalizeText(c))).filter((x): x is string => !!x))].slice(0, max);
}

// Até 2 matérias para a sessão: a da disciplina e as achadas pelo tema da sessão concorrem, e a IA escolhe.
export const MateriasChoice = z.object({
  materias: z.array(z.string()).describe('Até 2 matérias candidatas, exatamente como escritas, a principal primeiro; lista vazia se nenhuma serve.'),
});
export const materiasJsonSchema = () => z.toJSONSchema(MateriasChoice, { target: 'draft-7' });
export function materiasPrompt(p: { subject: string; title: string; keyword: string; topics: string[]; preferred: string | null; candidates: string[] }) {
  return `Estamos escolhendo de que matérias de um banco de questões virão as questões de uma sessão de estudo para concurso.
Disciplina do edital: ${p.subject}
Tema da sessão (o foco): ${p.title}
Palavra-chave: ${p.keyword || '—'}
Item do edital (só contexto): ${p.topics.join(' | ').slice(0, 900) || '—'}
Matérias do banco de questões (escolha somente desta lista, exatamente como escritas):
${p.candidates.map((c) => `- ${c}${c === p.preferred ? ' (matéria da disciplina)' : ''}`).join('\n')}
Escolha a matéria cujas questões melhor treinam o TEMA da sessão, e uma segunda só quando ela acrescenta questões do tema:
- o tema junta partes que ficam em matérias diferentes (ex.: "Ética e relações interpessoais" → "Ética" e "Relações Humanas");
- uma matéria específica do tema completa a geral (ex.: sessão de microeconomia → "Microeconomia" e "Economia").
${p.preferred ? `- "${p.preferred}" é a matéria da disciplina e já está escolhida: devolva-a primeiro e acrescente outra só se ela trouxer questões do tema que a da disciplina não tem.\n` : ''}- Não escolha matéria de outro assunto só porque o nome parece (ex.: "Dados Abertos" para estatística), nem de outro estado, município ou órgão.
- Se nenhuma servir, devolva lista vazia.`;
}

// ---------- orquestração (mesma lógica na Edge Function e na avaliação) ----------
// `ai` chama o Gemini com um schema; `assuntosOf` devolve (com cache) a lista oficial de assuntos da matéria.
export interface MapDeps {
  materias: (q: string) => Promise<string[]>;
  assuntosOf: (materia: string) => Promise<string[]>;
  // quick: escolha simples (qual matéria), com raciocínio baixo; a escolha de assuntos usa o raciocínio normal.
  ai: <T>(schema: z.ZodType<T>, jsonSchema: unknown, prompt: string, opts?: { quick?: boolean }) => Promise<T>;
  // Busca parcial de assuntos dentro da matéria (opcional; sem ela, só o pré-filtro local).
  assuntosMatching?: (materia: string, q: string) => Promise<string[]>;
}
// materiaOf: assuntos que vieram de uma segunda matéria (assunto → matéria); os outros são da principal.
export interface SessionFilter { materia: string | null; assuntos: string[]; how: string; materiaOf?: Record<string, string> | null }
export const materiaOf = (f: SessionFilter, assunto: string) => f.materiaOf?.[assunto] ?? f.materia;

// Buscas de matéria para um nome: o nome inteiro, cada parte de um nome composto ("Economia e Finanças públicas" →
// "Economia", "Finanças públicas") e a última palavra. A API busca pelo trecho, então o nome composto inteiro não acha nada.
export function materiaQueries(q: string, max = 4) {
  const parts = q.split(/\s+e\s+|[,;/]/i).map((p) => p.trim()).filter((p) => p.length > 3);
  const words = q.split(' ').filter((w) => w.length > 3);
  return [...new Set([q, ...(parts.length > 1 ? parts : []), ...(words.length > 1 ? [words[words.length - 1]!] : [])])].slice(0, max);
}

async function candidates(d: MapDeps, q: string) {
  const found: string[] = [];
  for (const x of materiaQueries(q)) found.push(...(await d.materias(x)));
  return fullMaterias(found);
}

// Matéria da disciplina: pontuação pelo nome, mas matéria "vazia" (≤ 2 assuntos) perde para a versão cheia
// (ex.: "Direito Processual Civil" × "Direito Processual Civil - CPC 2015"). IA só nos casos ambíguos.
// Matérias de outro estado, município ou órgão ficam de fora (`placeFilter`), com o órgão do edital como referência.
// Trechos do tema para a busca parcial de assuntos da API: palavras longas do título e da palavra-chave, no singular e com
// acento (a API compara o texto), as mais longas primeiro.
export function assuntoTerms(title: string, keyword: string, max = 4) {
  const head = title.split(':')[0]!.replace(/\(.*?\)/g, ' ');
  const words = `${head} ${keyword}`.toLowerCase().split(/[^\p{L}\d-]+/u)
    .filter((w) => w.length >= 5 && !STOP.has(normalizeText(w)) && !GENERIC_WORDS.has(normalizeText(w)))
    .map((w) => w.replace(/ções$/, 'ção').replace(/ões$/, 'ão').replace(/ais$/, 'al').replace(/(?<=.{3})s$/, ''));
  return [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, max);
}

export async function mapSubject(d: MapDeps, subject: { name: string; topics: string[]; organization?: string }): Promise<{ materia: string | null; how: string }> {
  const known = subjectMateria(subject.name);
  if (known) return { materia: known, how: 'nome' };
  if (genericSubject(subject.name)) return { materia: null, how: 'nome genérico: matéria por sessão' };
  const q = subject.name.replace(/^(noções|nocoes) (de|do|da|dos|das) /i, '');
  const fits = placeFilter([subject.organization ?? '', subject.name, ...subject.topics].join(' | '));
  const cands = (await candidates(d, q)).filter(fits);
  const ranked = cands.map((c) => ({ c, s: scoreMateria(subject.name, c) })).sort((x, y) => y.s - x.s).slice(0, 5);
  const scored: { c: string; s: number }[] = [];
  for (const r of ranked.filter((x) => x.s >= 40)) {
    const n = (await d.assuntosOf(r.c)).length;
    scored.push({ c: r.c, s: r.s - (n <= 2 ? 80 : 0) + Math.min(10, Math.log2(n + 1)) });
  }
  scored.sort((x, y) => y.s - x.s);
  if (scored[0] && scored[0].s >= 60) return { materia: scored[0].c, how: 'nome' };
  if (!cands.length) return { materia: null, how: 'sem candidatas' };
  const r = await d.ai(MateriaChoice, materiaJsonSchema(), materiaPrompt(subject.name, subject.topics, ranked.map((x) => x.c).concat(cands).slice(0, 10)));
  const m = cands.find((c) => normalizeText(c) === normalizeText(r.materia)) ?? null;
  return { materia: m, how: m ? 'ia' : 'ia: nenhuma' };
}

// Banca do edital com o nome da API: "Instituto Nosso Rumo" → "NOSSO RUMO", "Fundação Getulio Vargas" → "FGV".
// Sem correspondência, fica sem banca: a primeira da busca por "Instituto" seria outra banca.
const BOARD_WORDS = new Set(['instituto', 'fundacao', 'centro', 'consultoria', 'concursos', 'assessoria', 'organizacao', 'empresa']);
export async function pickBoard(board: string, search: (q: string) => Promise<string[]>) {
  const norm = normalizeText(board), words = norm.split(' ').filter((w) => w.length > 1 && !STOP.has(w));
  if (!words.length) return '';
  const initials = words.map((w) => w[0]).join('');
  const fits = (b: string) => {
    const n = normalizeText(b), t = n.split(' ');
    return n === norm || n === initials || t.includes(norm) || (t.every((x) => words.includes(x)) && t.some((x) => !BOARD_WORDS.has(x)));
  };
  const queries = [board, ...(words.length > 1 ? [initials] : []), ...words.filter((w) => !BOARD_WORDS.has(w))];
  for (const q of [...new Set(queries)].slice(0, 4)) {
    const hit = (await search(q)).find(fits);
    if (hit) return hit;
  }
  return '';
}

// Município do edital ("Prefeitura Municipal de Suzano" → "Suzano"); vazio se o órgão não é municipal.
export function localPlace(organization: string) {
  const m = organization.match(/(?:prefeitura|c[aâ]mara|munic[ií]pio)(?: municipal)? (?:de|do|da|dos|das) (.+)/i);
  return m ? m[1]!.replace(/\s*[-–/(,].*$/, '').trim() : '';
}

// Órgão do edital como a API escreve nas provas ("TJ SP", "TRF 3", "Prefeitura de Suzano"), para o filtro `orgao` (busca
// parcial): provas anteriores do mesmo órgão são as que mais se parecem com a próxima. Sem forma conhecida, fica vazio.
export function orgaoKeyword(organization: string) {
  const organ = organSearch(organization).queries[0];
  if (organ) return organ;
  const city = localPlace(organization);
  if (!city) return '';
  return /^\s*c[aâ]mara/i.test(organization) ? `Câmara de ${city}` : /^\s*prefeitura/i.test(organization) ? `Prefeitura de ${city}` : '';
}

// Assuntos da sessão: primeiro na matéria da disciplina; sem assunto, procura outra matéria pela
// palavra-chave/título da sessão (ex.: Estatuto da PCD dentro de "Atualidades"). Sem nada, fica vazio.
// Sessão sobre o município do edital usa só matéria dele ("Município de Suzano - Legislação Aplicada"): as genéricas de
// municípios misturam outras cidades. Sem matéria do município, a sessão fica sem questões.
// Em qualquer caso, matéria ou assunto de outro estado, município ou órgão fica de fora (`placeFilter`).
export async function mapSession(d: MapDeps, subjectMateria: string | null,
  s: { subject: string; title: string; keyword: string; topics: string[]; organization?: string }): Promise<SessionFilter> {
  const text = [s.title, s.keyword, ...s.topics].join(' ');
  const fits = placeFilter([s.organization ?? '', s.subject, text].join(' | '));
  const city = localPlace(s.organization ?? ''), place = normalizeText(city);
  if (place && ` ${normalizeText(text)} `.includes(` ${place} `)) {
    const local = (await d.materias(city)).filter((c) => ` ${normalizeText(c)} `.includes(` ${place} `) && fits(c));
    const none = { materia: null, assuntos: [], how: 'sem matéria do município' };
    if (!local.length) return none;
    const pick = await d.ai(MateriaChoice, materiaJsonSchema(), materiaPrompt(`${s.subject} — sessão "${s.title}"`, s.topics, local));
    const materia = local.find((c) => normalizeText(c) === normalizeText(pick.materia));
    const assuntos = materia ? (await d.assuntosOf(materia)).slice(0, 5) : [];
    return materia && assuntos.length ? { materia, assuntos, how: 'matéria do município' } : none;
  }
  // Sessão que cita o órgão do edital ("Normas TJSP"): primeiro as matérias dele ("Legislação Aplicada - TJ SP"); a corregedoria
  // entra quando a sessão fala em normas ou corregedoria. Matéria de outro lugar fica de fora pela trava de lugar.
  const organ = organSearch(s.organization ?? ''), plainText = ` ${normalizeText(text)} `;
  if (organ.marks.some((m) => plainText.includes(` ${m} `))) {
    const queries = [...organ.queries, ...(/corregedoria|\bcgj\b|\bnormas\b/i.test(text) ? ['Corregedoria'] : [])];
    const found: string[] = [];
    for (const q of queries) found.push(...(await d.materias(q)));
    const cands = [...new Set(found)].filter(fits).slice(0, 12);
    if (cands.length) {
      const pick = await d.ai(MateriaChoice, materiaJsonSchema(), materiaPrompt(`${s.subject} — sessão "${s.title}"`, s.topics, cands));
      const materia = cands.find((c) => normalizeText(c) === normalizeText(pick.materia));
      const assuntos = materia ? (await d.assuntosOf(materia)).slice(0, 5) : [];
      if (materia && assuntos.length) return { materia, assuntos, how: 'matéria do órgão' };
    }
  }
  const tryMateria = async (materia: string, quick = false) => {
    const lista = fits(materia) ? (await d.assuntosOf(materia)).filter(fits) : [];
    if (!lista.length) return [];
    // Lista grande: os assuntos que a busca parcial da API acha pelos trechos do tema entram primeiro, antes do pré-filtro
    // local, para o assunto certo não ficar de fora do corte de 120.
    const hits: string[] = [];
    if (lista.length > PREFILTER_MAX && d.assuntosMatching) for (const t of assuntoTerms(s.title, s.keyword)) hits.push(...await d.assuntosMatching(materia, t));
    const shown = [...new Set([...keepValid(hits, lista, 60), ...prefilterAssuntos(lista, [s.title, s.keyword].join(' '), PREFILTER_MAX, s.topics.join(' '))])].slice(0, PREFILTER_MAX);
    const r = await d.ai(AssuntoChoice, assuntoJsonSchema(), assuntoPrompt({ subject: s.subject, materia, title: s.title, keyword: s.keyword, topics: s.topics, assuntos: shown }), quick ? { quick } : undefined);
    return keepValid(r.assuntos, lista, ASSUNTO_CANDIDATES);
  };
  // Até 2 matérias por sessão: a da disciplina (quando rende assunto do tema) e uma achada pelo tema da sessão, se a IA
  // julgar que ela acrescenta questões do tema; sem a da disciplina, as achadas pelo tema concorrem entre si.
  const head = s.title.split(':')[0]!.replace(/\(.*?\)/g, '').trim();
  // Palavras longas do título também viram busca: "Introdução à Microeconomia e Mercados" não acha nada inteira, "Microeconomia" acha.
  const words = tokens(head).length > 1 ? head.split(/[\s,;/]+/).filter((w) => normalizeText(w).length >= 6 && tokens(w).length && !GENERIC_WORDS.has(normalizeText(w)))
    .sort((a, b) => b.length - a.length).slice(0, 2) : [];
  // Também pelo nome das leis citadas ("Lei 13.146" → "Estatuto da Pessoa com Deficiência"): siglas não são achadas na busca.
  const laws = findLawRefs(text, s.subject).map((r) => lawByKey(r.law)?.name).filter((n): n is string => !!n);
  const own = subjectMateria && fits(subjectMateria) ? subjectMateria : null;
  // A escolha dos assuntos da matéria da disciplina (IA) corre junto com as buscas de matéria (API, uma por vez).
  const ownPending = own ? tryMateria(own) : Promise.resolve([] as string[]);
  const found: string[] = [];
  try {
    for (const q of [...new Set([s.keyword, head, ...laws, ...words].filter(Boolean))].slice(0, 5)) found.push(...(await d.materias(q)));
  } catch (e) { await ownPending.catch(() => null); throw e; }
  const lists: { materia: string; assuntos: string[] }[] = [];
  const ownAssuntos = await ownPending;
  if (own && ownAssuntos.length) lists.push({ materia: own, assuntos: ownAssuntos });
  // Concorrem só matérias "cheias" e parecidas com o tema: a API tem muitas matérias que são um assunto só ("Crase",
  // "Introdução à Microeconomia"), e elas tirariam da sessão a matéria grande, com mais questões da banca.
  const theme = [head, s.keyword].join(' ');
  const ranked = fullMaterias(found).filter((c) => c !== subjectMateria && fits(c))
    .map((c) => ({ c, s: scoreMateria(theme, c) })).sort((a, b) => b.s - a.s).slice(0, SESSION_CANDIDATES).map((x) => x.c);
  const others: string[] = [];
  for (const c of ranked) if ((await d.assuntosOf(c)).length > HOLLOW_ASSUNTOS) others.push(c);
  if (others.length) {
    // A da disciplina, quando rende assunto, já está garantida: a IA escolhe se outra acrescenta questões do tema.
    const keep = lists.length ? own : null;
    const pick = await d.ai(MateriasChoice, materiasJsonSchema(), materiasPrompt({ subject: s.subject, title: s.title, keyword: s.keyword, topics: s.topics, preferred: keep, candidates: keep ? [keep, ...others] : others }), { quick: true });
    for (const materia of keepValid(pick.materias, others, 2)) {
      if (lists.length >= 2) break;
      // A segunda matéria só complementa: escolha de assuntos com raciocínio baixo (a triagem filtra o que fugir do tema).
      const a = await tryMateria(materia, lists.length > 0);
      if (a.length) lists.push({ materia, assuntos: a });
    }
  }
  if (!lists.length) return { materia: null, assuntos: [], how: found.length || own ? 'sem assunto' : 'sem matéria' };
  // Assuntos das duas matérias intercalados (a principal primeiro), sem repetir nome.
  const main = lists[0]!.materia, assuntos: string[] = [], second: Record<string, string> = {}, names = new Set<string>();
  for (const [materia, assunto] of interleave(lists.map((l) => l.assuntos.map((a) => [l.materia, a] as const)))) {
    if (assuntos.length >= ASSUNTO_CANDIDATES || names.has(normalizeText(assunto))) continue;
    names.add(normalizeText(assunto)); assuntos.push(assunto);
    if (materia !== main) second[assunto] = materia;
  }
  const how = lists.length > 1 ? 'duas matérias' : main === subjectMateria ? 'matéria da disciplina' : 'matéria pela sessão';
  return { materia: main, assuntos, how, ...(Object.keys(second).length ? { materiaOf: second } : {}) };
}

// Ordem de busca: banca nos assuntos (do mais relevante) e, se esgotar, os mesmos assuntos em outras bancas.
// Atualidades: só provas recentes (este ano e o anterior), senão os fatos estão desatualizados.
// Ano mínimo das provas no cronograma (API e cache); nas questões livres o estudante escolhe o ano.
export const recentMinYear = (materia: string | null | undefined, now = new Date()) => (/atualidade/i.test(materia ?? '') ? now.getFullYear() - 1 : undefined);
// Dificuldade das questões das sessões: média, difícil e muito difícil. A API só aceita um valor por busca.
// Sem a muito difícil faltariam questões: em amostra real, a escala 4 tinha 3 das 193 questões de um assunto, e a 5, 39.
export const SESSION_DIFFICULTIES = ['3', '4', '5'];
// Dia de aprofundamento: só difícil e muito difícil.
export const DEEP_DIFFICULTIES = ['4', '5'];

// Opção das questões livres que busca essas mesmas dificuldades.
export const MEDIUM_OR_HARD = 'media-dificil';

// Alterna os itens das listas: um de cada, até acabarem.
export function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) for (const l of lists) if (i < l.length) out.push(l[i]!);
  return out;
}

// board: busca só na banca do edital (as outras completam o que faltar).
export interface SearchFilter { key: string; assunto: string; tier: number; turn: number; board: boolean; params: Record<string, string> }

// Formato predominante da banca, para treinar igual ao que ela cobra mesmo em questões de outras bancas.
export const QUESTION_FORMATS = ['multipla escolha', 'certo e errado'];
const FORMAT_SHARE = 0.6;
export function dominantFormat(counts: Record<string, number>) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  return total && n / total >= FORMAT_SHARE ? best : '';
}

// Nome do cargo para o filtro `cargo` da API, que busca por parte do texto: sem área nem especialidade.
export function roleKeyword(role: string) {
  const head = role.split(/\s[-–—]\s|[(:,/]/)[0]!.trim();
  return head.length >= 4 ? head : '';
}

// Busca da mais à menos específica: provas do mesmo órgão, mesmo cargo, mesma carreira (a específica, depois a geral), depois
// escolaridade do edital, depois qualquer uma; em cada etapa, a banca e
// depois as outras no formato dela. Nunca solta a dificuldade.
export function searchFilters(f: SessionFilter, banca: string, o: { level?: string; role?: string; orgao?: string; carreiras?: string[]; format?: string; anyFormat?: boolean; difficulties?: string[] } = {}, now = new Date()): SearchFilter[] {
  if (!f.materia || !f.assuntos.length) return [];
  const m = f.materia, format: Record<string, string> = o.format && !o.anyFormat ? { tipo: o.format } : {};
  const minYear = recentMinYear(m, now);
  // Formatos misturados de propósito (estudo sem prova marcada): a posição de busca é outra, então a chave muda junto.
  const mixed = o.anyFormat ? '~' : '';
  const places: { tag: string; board: boolean; params: Record<string, string> }[] = minYear
    ? [now.getFullYear(), minYear].map((ano) => ({ tag: `${ano}${mixed}`, board: false, params: { ano: String(ano), ...format } }))
    : [...(banca ? [{ tag: 'b', board: true, params: { banca } }] : []), { tag: `*${mixed}`, board: false, params: format }];
  const narrowed = (tag: string, extra: Record<string, string>) => places.map((p) => ({ tag: `${tag}|${p.tag}`, board: p.board, params: { ...p.params, ...extra } }));
  const tiers = [
    ...(o.orgao ? narrowed(`o:${o.orgao}`, { orgao: o.orgao }) : []),
    ...(o.role ? narrowed(`c:${o.role}`, { cargo: o.role }) : []),
    ...(o.carreiras ?? []).flatMap((carreira) => narrowed(`k:${carreira}`, { carreira })),
    ...(o.level ? narrowed(o.level, { nivel_escolaridade: o.level }) : []),
    ...places,
  ];
  return tiers.flatMap((t, tier) => f.assuntos.flatMap((assunto) => (o.difficulties ?? SESSION_DIFFICULTIES).map((dificuldade, turn) => ({
    key: `${t.tag}:${f.materiaOf?.[assunto] ? `${f.materiaOf[assunto]}>` : ''}${assunto}:d${dificuldade}`, assunto, tier, turn, board: t.board, params: { ...t.params, materia: materiaOf(f, assunto)!, assunto, dificuldade },
  }))));
}

// A API ordena da mais antiga para a mais nova: para vir das mais novas, anda de trás para frente. `position` é a posição da
// próxima questão a buscar, contada da mais antiga. O tamanho da página divide a posição, para terminar nela sem pular nenhuma.
export function newestPage(position: number, want: number) {
  let perPage = Math.min(want, position);
  while (position % perPage) perPage--;
  return { page: position / perPage, perPage };
}

// Ordem de busca de uma questão: alterna a dificuldade a cada vez, para não esgotar só a primeira.
export const inTurn = (filters: SearchFilter[], turn: number) => {
  const n = SESSION_DIFFICULTIES.length, place = (f: SearchFilter) => (((f.turn - turn) % n) + n) % n;
  return [...filters].sort((a, b) => a.tier - b.tier || place(a) - place(b));
};

// ---------- distribuição das questões entre os assuntos da sessão ----------
export interface Incidence { assunto: string; total: number }
export const equalIncidence = (assuntos: string[]): Incidence[] => assuntos.map((assunto) => ({ assunto, total: 1 }));

// Quantas questões a banca tem em cada assunto, na ordem de relevância do mapa, até 5 assuntos com questões. Assunto sem
// questão na banca entra com total 0 se tiver ao menos 5 nas outras; com menos, sai: buscá-lo gastaria ~1,1 s por filtro
// (limite da API) e estouraria o tempo do pedido antes dos assuntos bons, mandando a sessão para as questões da IA.
// Sem nenhuma questão na banca, valem os totais das outras bancas.
// Atualidades fica em partes iguais: só contam as provas recentes, e o histórico não diz o que volta a cair.
export const MIN_ASSUNTO_QUESTIONS = 5;
export async function measureIncidence(count: (params: Record<string, string>) => Promise<number>, f: SessionFilter, banca: string, max = SESSION_ASSUNTOS): Promise<Incidence[]> {
  if (!f.materia || /atualidade/i.test(f.materia)) return equalIncidence(f.assuntos.slice(0, max));
  const out: { assunto: string; total: number; all: number }[] = [];
  for (const assunto of f.assuntos) {
    if (out.length >= max) break;
    const materia = materiaOf(f, assunto)!;
    const inBoard = banca ? await count({ banca, materia, assunto }) : 0;
    if (inBoard > 0) { out.push({ assunto, total: inBoard, all: inBoard }); continue; }
    const all = await count({ materia, assunto });
    if (all >= MIN_ASSUNTO_QUESTIONS) out.push({ assunto, total: 0, all });
  }
  const board = out.some((i) => i.total > 0);
  return out.map((i) => ({ assunto: i.assunto, total: board ? i.total : i.all }));
}

// Cargo e escolaridade só estreitam a busca quando rendem. Com menos de 500 questões na matéria (ex.: "Oficial de Justiça",
// 178 no CPC), quase todo assunto volta vazio; com mais de 90% dela (nível superior, 97% no CPC), repetem a busca sem filtro.
// Cada nível inútil custa 3 buscas por assunto (uma por dificuldade), ~1,1 s cada pelo limite da API.
export const NARROW_MIN = 500, NARROW_MAX_SHARE = 0.9;
// Órgão: só entra na busca da disciplina se as provas dele têm ao menos esse tanto de questões na matéria.
export const ORGAO_MIN = 10;
// Carreira: entra com ao menos tantas questões na matéria e sem ser quase toda ela (aí não estreita nada).
export const CARREIRA_MIN = 30;
export const usefulCarreira = (materiaTotal: number, inCareer: number) => inCareer >= CARREIRA_MIN && inCareer <= materiaTotal * NARROW_MAX_SHARE;

// Carreiras do banco de questões para o edital: a mais específica primeiro e a geral dela depois (uma vez por edital).
export const CarreiraChoice = z.object({
  carreiras: z.array(z.string()).describe('Até 2 carreiras da lista, exatamente como escritas: a mais específica primeiro, depois a geral dela; lista vazia se nenhuma serve.'),
});
export const carreiraJsonSchema = () => z.toJSONSchema(CarreiraChoice, { target: 'draft-7' });
export function carreiraPrompt(p: { organization: string; role: string; duties: string; level: string; candidates: string[] }) {
  return `Estamos filtrando um banco de questões de concursos pela carreira do candidato.
Órgão do concurso: ${p.organization || '—'}
Cargo: ${p.role || '—'}${p.level ? ` (nível ${p.level})` : ''}
Atribuições: ${p.duties.slice(0, 600) || '—'}
Carreiras do banco (escolha somente desta lista, exatamente como escritas):
${p.candidates.map((c) => `- ${c}`).join('\n')}
Escolha a carreira mais específica que corresponde a este órgão e cargo e, em seguida, a carreira geral da qual ela faz parte (ex.: "Tribunais / Justiça Comum Federal e Estadual (STF, STJ, CNJ, TRFs e TJ’s)" e depois "Tribunais"). Se só houver a geral, devolva só ela. Não escolha carreira de outro tipo de órgão nem de outra área de atuação. Se nenhuma servir, devolva lista vazia.`;
}
export const usefulNarrowing = (materiaTotal: number, narrowed: number) => narrowed >= NARROW_MIN && narrowed <= materiaTotal * NARROW_MAX_SHARE;

// Quais assuntos recebem as próximas n questões: primeiro todos passam pela sessão, do mais ao menos cobrado;
// depois, cada questão vai para o assunto que está mais abaixo da sua parte na cobrança da banca.
export function planPicks(incidence: Incidence[], served: Map<string, number>, n: number) {
  const rows = incidence.map((i, order) => ({ assunto: i.assunto, weight: Math.max(i.total, 1), order, got: served.get(normalizeText(i.assunto)) ?? 0 }));
  const picks: string[] = [];
  for (let slot = 0; rows.length && slot < n; slot++) {
    const next = [...rows].sort((a, b) => Number(b.got === 0) - Number(a.got === 0) || (a.got === 0 ? b.weight - a.weight : (a.got + 1) / a.weight - (b.got + 1) / b.weight) || a.order - b.order)[0]!;
    next.got++;
    picks.push(next.assunto);
  }
  return picks;
}

// ---------- explicação da questão (IA), ancorada no texto oficial da lei ----------
// explain-v2: a explicação ensina a acertar a próxima questão do mesmo tipo. Começa pela regra que decide (reaproveitável),
// aponta em cada alternativa errada o trecho exato que a derruba, mostra a conta em cálculo, trata certo ou errado como um
// item só, avisa quando a questão depende de imagem que a IA não recebeu e quando a lei atual não combina com o gabarito.
// Com súmulas e teses oficiais ligadas aos artigos da questão, a explicação pode citá-las (só as fornecidas).
// As explicações já gravadas continuam valendo (uma por questão, compartilhada): só as novas saem neste formato.
export const EXPLAIN_PROMPT_VERSION = 'explain-v2';
export const Explanation = z.object({
  resumo: z.string().describe('Primeiro a regra que decide a questão, numa frase que sirva para outras questões do tema; depois, como ela leva ao gabarito. Até 5 frases.'),
  alternativas: z.array(z.object({ letra: z.string(), comentario: z.string().describe('Errada: o trecho que a torna errada e como ficaria certa. Certa: o que a confirma. 1–2 frases, sem repetir o texto da alternativa.') })),
  artigos: z.array(z.string()).describe('Artigos usados, no formato "CP, art. 312" — somente dos trechos de lei fornecidos.'),
  dica: z.string().describe('Como reconhecer esta cobrança na próxima questão: a troca ou o detalhe que a banca explora, em 1 frase (ou vazio).'),
});
export type Explanation = z.infer<typeof Explanation>;
export const explanationJsonSchema = () => z.toJSONSchema(Explanation, { target: 'draft-7' });

// assunto: assunto da questão no banco, para situar a regra. imagens: a questão tem figura ou anexo que a IA não recebe.
export function explainPrompt(p: { banca: string; enunciado: string; alternativas: { letra: string; texto: string }[]; gabarito: string; textos: string[]; lei: { ref: string; text: string }[]; assunto?: string; imagens?: boolean; juris?: { ref: string; text: string }[] }) {
  const juris = p.juris ?? [];
  return `Você é professor de cursinho para concursos. Explique a questão abaixo para um estudante que a errou e quer acertar a próxima do mesmo tipo.
${p.assunto ? `Assunto: ${p.assunto}\n` : ''}${p.textos.length ? `Texto associado:\n${p.textos.join('\n').slice(0, 3000)}\n` : ''}Questão (${p.banca || 'banca não informada'}):
${p.enunciado}
${p.alternativas.map((a) => `${a.letra}) ${a.texto}`).join('\n')}
Gabarito oficial: ${p.gabarito}
${p.lei.length ? `Trechos oficiais da lei (use somente estes como fonte legal):\n${p.lei.map((l) => `[${l.ref}] ${l.text}`).join('\n\n').slice(0, 12000)}` : 'Nenhum trecho de lei foi fornecido.'}
${juris.length ? `Jurisprudência oficial do STF e do STJ ligada a esses artigos (texto publicado pelo tribunal; única jurisprudência que pode ser citada):\n${juris.map((j) => `[${j.ref}] ${j.text}`).join('\n\n').slice(0, 6000)}\n` : ''}Regras:
- O gabarito oficial é a referência: explique o raciocínio da banca e nunca diga que outra alternativa é a correta. Se o trecho de lei fornecido (texto atual) não combinar com o gabarito, mantenha o gabarito e avise na dica que a lei pode ter mudado depois da prova.
- resumo: comece pela regra que decide a questão, escrita de um jeito que sirva para outras questões do tema; só depois aplique ao caso. O estudante precisa sair com a regra, não só com a resposta desta questão.
- Em cada alternativa errada, aponte a palavra ou o trecho que a torna errada e diga como ficaria correta. "Está errada porque contraria a lei" não ensina nada. Não repita o texto da alternativa.
- Questão de certo ou errado: um único comentário, com a letra do gabarito (C ou E), apontando o trecho que torna o item certo ou errado.
- Questão de cálculo ou de raciocínio lógico: mostre a conta ou os passos no resumo, na ordem em que o candidato os faria na prova.
- Cite artigos somente se estiverem nos trechos fornecidos, no formato do colchete (ex.: "CP, art. 312"). ${juris.length ? 'Jurisprudência: quando um item fornecido decide a questão ou alguma alternativa, cite-o pelo nome do colchete (ex.: "Súmula 17/STJ") e reproduza o sentido do enunciado oficial, sem acrescentar regra ou exceção. Se a questão depender de julgado que não está entre os fornecidos, explique o entendimento sem dar número de súmula ou de tema. Não cite autores.' : 'Não cite jurisprudência, súmulas nem autores.'}
- Se não houver trecho de lei, explique pelo raciocínio, sem números de artigos.${p.imagens ? '\n- A questão tem imagem ou anexo que você não recebeu: diga isso no resumo e explique só o que o texto permite, sem supor o conteúdo da imagem.' : ''}
- dica: a troca ou o detalhe que a banca explora neste tipo de questão, para o estudante reconhecer da próxima vez. Sem dica útil, deixe vazio.
- Linguagem simples e direta, sem rodeios e sem elogiar a questão.`;
}

