// Liga o edital ao banco de questões: matéria do edital → matéria da API (por matéria) e
// sessão do cronograma → assuntos da API (por sessão). Determinístico quando dá; IA nos casos ambíguos,
// sempre escolhendo dentro das listas oficiais da API (nunca inventa nome de matéria ou assunto).
import { z } from 'zod';
import { normalizeText } from '../ai/notice.ts';
import { findLawRefs } from '../legal/refs.ts';
import { lawByKey } from '../legal/registry.ts';

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
  return [...new Set([...(await d.materias(q)), ...(parts.length > 1 ? await d.materias(parts[parts.length - 1]!) : [])])];
}

// Matéria da disciplina: pontuação pelo nome, mas matéria "vazia" (≤ 2 assuntos) perde para a versão cheia
// (ex.: "Direito Processual Civil" × "Direito Processual Civil - CPC 2015"). IA só nos casos ambíguos.
export async function mapSubject(d: MapDeps, subject: { name: string; topics: string[] }): Promise<{ materia: string | null; how: string }> {
  const q = subject.name.replace(/^(noções|nocoes) (de|do|da|dos|das) /i, '');
  const cands = await candidates(d, q);
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

// Assuntos da sessão: primeiro na matéria da disciplina; sem assunto, procura outra matéria pela
// palavra-chave/título da sessão (ex.: Estatuto da PCD dentro de "Atualidades"). Sem nada, fica vazio.
export async function mapSession(d: MapDeps, subjectMateria: string | null,
  s: { subject: string; title: string; keyword: string; topics: string[] }): Promise<SessionFilter> {
  const text = [s.title, s.keyword, ...s.topics].join(' ');
  const tryMateria = async (materia: string) => {
    const lista = await d.assuntosOf(materia);
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
  const cands = [...new Set(found)].filter((c) => c !== subjectMateria).slice(0, 12);
  if (!cands.length) return { materia: null, assuntos: [], how: 'sem matéria' };
  const pick = await d.ai(MateriaChoice, materiaJsonSchema(), materiaPrompt(`${s.subject} — sessão "${s.title}"`, s.topics, cands));
  const materia = cands.find((c) => normalizeText(c) === normalizeText(pick.materia));
  if (!materia) return { materia: null, assuntos: [], how: 'sem matéria' };
  const a = await tryMateria(materia);
  return a.length ? { materia, assuntos: a, how: 'matéria pela sessão' } : { materia: null, assuntos: [], how: 'sem assunto' };
}

// Ordem de busca: banca nos assuntos (do mais relevante) e, se esgotar, os mesmos assuntos em outras bancas.
// Atualidades: só provas recentes (este ano e o anterior), senão os fatos estão desatualizados.
export function searchFilters(f: SessionFilter, banca: string, now = new Date()): { key: string; params: Record<string, string> }[] {
  if (!f.materia || !f.assuntos.length) return [];
  const m = f.materia;
  if (/atualidade/i.test(m)) {
    const years = [now.getFullYear(), now.getFullYear() - 1].map(String);
    return years.flatMap((ano) => f.assuntos.map((assunto) => ({ key: `${ano}:${assunto}`, params: { materia: m, assunto, ano } })));
  }
  return [
    ...f.assuntos.map((assunto) => ({ key: `b:${assunto}`, params: { banca, materia: m, assunto } })),
    ...f.assuntos.map((assunto) => ({ key: `*:${assunto}`, params: { materia: m, assunto } })),
  ];
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

