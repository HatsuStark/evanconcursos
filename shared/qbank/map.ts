// Liga o edital ao banco de questões: matéria do edital → matéria da API (por matéria) e
// sessão do cronograma → assuntos da API (por sessão). Determinístico quando dá; IA nos casos ambíguos,
// sempre escolhendo dentro das listas oficiais da API (nunca inventa nome de matéria ou assunto).
import { z } from 'zod';
import { normalizeText } from '../ai/notice.ts';
import { findLawRefs } from '../legal/refs.ts';
import { lawByKey } from '../legal/registry.ts';
import { fullMaterias, subjectMateria } from './materias.ts';
import { placeFilter } from './places.ts';

export const QMAP_PROMPT_VERSION = 'qmap-v3';

const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'em', 'no', 'na', 'nos', 'nas', 'para', 'por', 'com', 'ao', 'aos', 'art', 'arts', 'lei', 'nocoes', 'noções']);
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
export function prefilterAssuntos(assuntos: string[], sessionText: string, max = 120) {
  const st = new Set(tokens(sessionText));
  if (!st.size || assuntos.length <= max) return assuntos.slice(0, max);
  return assuntos.map((a, i) => ({ a, i, s: tokens(a).filter((t) => st.has(t)).length }))
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
  assuntos: z.array(z.string()).describe('Até 5 assuntos da lista, exatamente como escritos, do mais ao menos relevante.'),
});
export const assuntoJsonSchema = () => z.toJSONSchema(AssuntoChoice, { target: 'draft-7' });
export function assuntoPrompt(p: { subject: string; materia: string; title: string; keyword: string; topics: string[]; assuntos: string[] }) {
  return `Estamos escolhendo questões de concurso para uma sessão de estudo.
Disciplina: ${p.subject} (no banco de questões: ${p.materia})
Sessão: ${p.title}
Palavra-chave: ${p.keyword || '—'}
Conteúdo do edital coberto: ${p.topics.join(' | ').slice(0, 1200) || '—'}
Assuntos disponíveis no banco de questões (escolha somente desta lista, exatamente como escritos):
${p.assuntos.map((a) => `- ${a}`).join('\n')}
Escolha até 5 assuntos cujas questões treinam exatamente o conteúdo desta sessão, do mais ao menos relevante.
Não escolha assuntos de outras partes da matéria. Se nenhum servir, devolva lista vazia.`;
}

// Mantém só escolhas que existem na lista (comparação sem acento/caixa), na forma oficial.
export function keepValid(chosen: string[], list: string[], max = 5) {
  const byNorm = new Map(list.map((a) => [normalizeText(a), a]));
  return [...new Set(chosen.map((c) => byNorm.get(normalizeText(c))).filter((x): x is string => !!x))].slice(0, max);
}

// ---------- orquestração (mesma lógica na Edge Function e na avaliação) ----------
// `ai` chama o Gemini com um schema; `assuntosOf` devolve (com cache) a lista oficial de assuntos da matéria.
export interface MapDeps {
  materias: (q: string) => Promise<string[]>;
  assuntosOf: (materia: string) => Promise<string[]>;
  ai: <T>(schema: z.ZodType<T>, jsonSchema: unknown, prompt: string) => Promise<T>;
}
export interface SessionFilter { materia: string | null; assuntos: string[]; how: string }

async function candidates(d: MapDeps, q: string) {
  const parts = q.split(' ').filter((w) => w.length > 3);
  return fullMaterias([...(await d.materias(q)), ...(parts.length > 1 ? await d.materias(parts[parts.length - 1]!) : [])]);
}

// Matéria da disciplina: pontuação pelo nome, mas matéria "vazia" (≤ 2 assuntos) perde para a versão cheia
// (ex.: "Direito Processual Civil" × "Direito Processual Civil - CPC 2015"). IA só nos casos ambíguos.
// Matérias de outro estado, município ou órgão ficam de fora (`placeFilter`), com o órgão do edital como referência.
export async function mapSubject(d: MapDeps, subject: { name: string; topics: string[]; organization?: string }): Promise<{ materia: string | null; how: string }> {
  const known = subjectMateria(subject.name);
  if (known) return { materia: known, how: 'nome' };
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
  const tryMateria = async (materia: string) => {
    const lista = fits(materia) ? (await d.assuntosOf(materia)).filter(fits) : [];
    if (!lista.length) return [];
    const r = await d.ai(AssuntoChoice, assuntoJsonSchema(), assuntoPrompt({ subject: s.subject, materia, title: s.title, keyword: s.keyword, topics: s.topics, assuntos: prefilterAssuntos(lista, text) }));
    return keepValid(r.assuntos, lista);
  };
  if (subjectMateria) {
    const a = await tryMateria(subjectMateria);
    if (a.length) return { materia: subjectMateria, assuntos: a, how: 'matéria da disciplina' };
  }
  const head = s.title.split(':')[0]!.replace(/\(.*?\)/g, '').trim();
  // Também pelo nome das leis citadas ("Lei 13.146" → "Estatuto da Pessoa com Deficiência"): siglas não são achadas na busca.
  const laws = findLawRefs(text, s.subject).map((r) => lawByKey(r.law)?.name).filter((n): n is string => !!n);
  const found: string[] = [];
  for (const q of [...new Set([s.keyword, head, ...laws].filter(Boolean))].slice(0, 4)) found.push(...(await d.materias(q)));
  const cands = fullMaterias(found).filter((c) => c !== subjectMateria && fits(c)).slice(0, 12);
  if (!cands.length) return { materia: null, assuntos: [], how: 'sem matéria' };
  const pick = await d.ai(MateriaChoice, materiaJsonSchema(), materiaPrompt(`${s.subject} — sessão "${s.title}"`, s.topics, cands));
  const materia = cands.find((c) => normalizeText(c) === normalizeText(pick.materia));
  if (!materia) return { materia: null, assuntos: [], how: 'sem matéria' };
  const a = await tryMateria(materia);
  return a.length ? { materia, assuntos: a, how: 'matéria pela sessão' } : { materia: null, assuntos: [], how: 'sem assunto' };
}

// Ordem de busca: banca nos assuntos (do mais relevante) e, se esgotar, os mesmos assuntos em outras bancas.
// Atualidades: só provas recentes (este ano e o anterior), senão os fatos estão desatualizados.
// Dificuldade das questões das sessões: média, difícil e muito difícil. A API só aceita um valor por busca.
// Sem a muito difícil faltariam questões: em amostra real, a escala 4 tinha 3 das 193 questões de um assunto, e a 5, 39.
export const SESSION_DIFFICULTIES = ['3', '4', '5'];

// Opção das questões livres que busca essas mesmas dificuldades.
export const MEDIUM_OR_HARD = 'media-dificil';

// Alterna os itens das listas: um de cada, até acabarem.
export function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) for (const l of lists) if (i < l.length) out.push(l[i]!);
  return out;
}

export interface SearchFilter { key: string; assunto: string; tier: number; turn: number; params: Record<string, string> }

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

// Busca da mais à menos específica: mesmo cargo, depois escolaridade do edital, depois qualquer uma; em cada etapa, a banca e
// depois as outras no formato dela. Nunca solta a dificuldade.
export function searchFilters(f: SessionFilter, banca: string, o: { level?: string; role?: string; format?: string } = {}, now = new Date()): SearchFilter[] {
  if (!f.materia || !f.assuntos.length) return [];
  const m = f.materia, format: Record<string, string> = o.format ? { tipo: o.format } : {};
  const places: { tag: string; params: Record<string, string> }[] = /atualidade/i.test(m)
    ? [now.getFullYear(), now.getFullYear() - 1].map((ano) => ({ tag: String(ano), params: { ano: String(ano), ...format } }))
    : [{ tag: 'b', params: { banca } }, { tag: '*', params: format }];
  const narrowed = (tag: string, extra: Record<string, string>) => places.map((p) => ({ tag: `${tag}|${p.tag}`, params: { ...p.params, ...extra } }));
  const tiers = [
    ...(o.role ? narrowed(`c:${o.role}`, { cargo: o.role }) : []),
    ...(o.level ? narrowed(o.level, { nivel_escolaridade: o.level }) : []),
    ...places,
  ];
  return tiers.flatMap((t, tier) => f.assuntos.flatMap((assunto) => SESSION_DIFFICULTIES.map((dificuldade, turn) => ({
    key: `${t.tag}:${assunto}:d${dificuldade}`, assunto, tier, turn, params: { ...t.params, materia: m, assunto, dificuldade },
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

// Quantas questões a banca tem em cada assunto. Sem nenhuma na banca, vale o total das outras bancas.
// Atualidades fica em partes iguais: só contam as provas recentes, e o histórico não diz o que volta a cair.
export async function measureIncidence(count: (params: Record<string, string>) => Promise<number>, f: SessionFilter, banca: string): Promise<Incidence[]> {
  if (!f.materia || /atualidade/i.test(f.materia)) return equalIncidence(f.assuntos);
  const measure = async (extra: Record<string, string>) => {
    const out: Incidence[] = [];
    for (const assunto of f.assuntos) out.push({ assunto, total: await count({ ...extra, materia: f.materia!, assunto }) });
    return out;
  };
  const inBoard = banca ? await measure({ banca }) : [];
  return inBoard.some((i) => i.total > 0) ? inBoard : measure({});
}

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
export const EXPLAIN_PROMPT_VERSION = 'explain-v1';
export const Explanation = z.object({
  resumo: z.string().describe('Por que a alternativa correta está certa, em até 5 frases.'),
  alternativas: z.array(z.object({ letra: z.string(), comentario: z.string().describe('Por que está certa ou errada, em 1–2 frases.') })),
  artigos: z.array(z.string()).describe('Artigos usados, no formato "CP, art. 312" — somente dos trechos de lei fornecidos.'),
  dica: z.string().describe('Pegadinha ou ponto de atenção da banca, em 1 frase (ou vazio).'),
});
export type Explanation = z.infer<typeof Explanation>;
export const explanationJsonSchema = () => z.toJSONSchema(Explanation, { target: 'draft-7' });

export function explainPrompt(p: { banca: string; enunciado: string; alternativas: { letra: string; texto: string }[]; gabarito: string; textos: string[]; lei: { ref: string; text: string }[] }) {
  return `Você é professor de cursinho para concursos. Explique a questão abaixo para um estudante.
${p.textos.length ? `Texto associado:\n${p.textos.join('\n').slice(0, 3000)}\n` : ''}Questão (${p.banca || 'banca não informada'}):
${p.enunciado}
${p.alternativas.map((a) => `${a.letra}) ${a.texto}`).join('\n')}
Gabarito oficial: ${p.gabarito}
${p.lei.length ? `Trechos oficiais da lei (use somente estes como fonte legal):\n${p.lei.map((l) => `[${l.ref}] ${l.text}`).join('\n\n').slice(0, 12000)}` : 'Nenhum trecho de lei foi fornecido.'}
Regras:
- Explique a partir do gabarito oficial; nunca o contradiga.
- Cite artigos somente se estiverem nos trechos fornecidos, no formato do colchete (ex.: "CP, art. 312"). Não cite jurisprudência, súmulas nem autores.
- Se não houver trecho de lei, explique pelo raciocínio, sem números de artigos.
- Comente cada alternativa em 1–2 frases. Linguagem simples e direta.`;
}

