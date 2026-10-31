// Apostila da sessão gerada pela IA: schema, prompt versionado e verificação das citações legais.
// Fontes permitidas: o conteúdo do edital da sessão e os artigos oficiais fornecidos (lei seca).
import { z } from 'zod';
import { findLawRefs, inRanges, type LawRef } from '../legal/refs.ts';
import { lawByKey } from '../legal/registry.ts';

export const GUIDE_PROMPT_VERSION = 'guide-v3';
export type GuideDepth = 'completa' | 'revisao';

export const Guide = z.object({
  titulo: z.string(),
  introducao: z.string().describe('Contexto e por que o tema importa para a prova, em até 4 frases.'),
  secoes: z.array(z.object({
    titulo: z.string(),
    texto: z.string().describe('Explicação didática em parágrafos separados por linha em branco.'),
    exemplos: z.array(z.string()).describe('Exemplos práticos curtos.'),
    como_banca_cobra: z.string().describe('Como a banca cobra o assunto desta seção, pelo que se vê nas questões fornecidas, em até 2 frases. Vazio se nenhuma questão fornecida tratar dele.'),
  })),
  legislacao: z.array(z.object({ ref: z.string().describe('Exatamente como no colchete do trecho fornecido, ex.: "CP, art. 312".'), comentario: z.string() })),
  pontos_banca: z.array(z.string()).describe('O que a banca mais cobra neste tema.'),
  pegadinhas: z.array(z.string()),
  resumo: z.array(z.string()).describe('Revisão em tópicos curtos.'),
  perguntas: z.array(z.object({ pergunta: z.string(), resposta: z.string() })),
  depende_legislacao: z.boolean().describe('true se o conteúdo depende de lei que pode ser alterada.'),
});
export type Guide = z.infer<typeof Guide>;
export const guideJsonSchema = () => z.toJSONSchema(Guide, { target: 'draft-7' });

export interface GuideSource { ref: string; text: string }

// ---------- perfil da banca: questões reais que embasam "como a banca cobra" ----------
export const BOARD_SAMPLE_MAX = 8;
const BOARD_TEXT_MAX = 500, BOARD_OPTION_MAX = 140;
export interface BoardQuestion { assunto: string; ano?: number | null; enunciado: string; alternativas: string[] }

// Amostra variada: uma questão de cada assunto por vez, para o perfil não sair de um assunto só.
export function boardSample(questions: BoardQuestion[], max = BOARD_SAMPLE_MAX) {
  const groups = new Map<string, BoardQuestion[]>();
  for (const q of questions) groups.set(q.assunto, [...(groups.get(q.assunto) ?? []), q]);
  const out: BoardQuestion[] = [];
  for (let round = 0; out.length < Math.min(max, questions.length); round++) {
    for (const list of groups.values()) if (list[round] && out.length < max) out.push(list[round]!);
  }
  return out;
}

// Sem questão real não há perfil: a IA não pode descrever a banca de memória. O número de questões fica na apostila.
export function applyBoardEvidence(g: Guide, banca: string, questions: number) {
  const secoes = questions ? g.secoes : g.secoes.map((s) => ({ ...s, como_banca_cobra: '' }));
  return { ...g, secoes, perfil_banca: questions ? { banca, questoes: questions } : null };
}

export function guidePrompt(p: { depth: GuideDepth; banca: string; cargo: string; subject: string; title: string; topics: string[]; law: GuideSource[]; boardQuestions?: BoardQuestion[] }) {
  const full = p.depth === 'completa', board = p.boardQuestions ?? [];
  return `Você é professor de cursinho para concursos públicos brasileiros. Escreva uma apostila ${full ? 'completa, para quem está começando' : 'de revisão curta, para quem já estudou o tema'}.
Concurso: ${p.cargo || 'não informado'}${p.banca ? `, banca ${p.banca}` : ''}.
Matéria: ${p.subject}
Tema da sessão: ${p.title}
Conteúdo do edital coberto: ${p.topics.join(' | ') || '—'}
${p.law.length ? `Trechos oficiais da lei (lei seca, única fonte legal permitida):\n${p.law.map((l) => `[${l.ref}] ${l.text}`).join('\n\n')}` : 'Nenhum trecho de lei foi fornecido para este tema.'}
${board.length ? `Questões reais da banca ${p.banca} sobre o tema (amostra, não o total):\n${board.map((q, i) => `Q${i + 1} (${[q.assunto, q.ano].filter(Boolean).join(', ')}): ${q.enunciado.slice(0, BOARD_TEXT_MAX)}${q.alternativas.length ? `\n${q.alternativas.map((a) => a.slice(0, BOARD_OPTION_MAX)).join(' | ')}` : ''}`).join('\n\n')}` : 'Nenhuma questão real da banca foi fornecida.'}
Regras obrigatórias:
- Escreva só sobre o "Tema da sessão", e dê à apostila um título sobre ele. O conteúdo do edital pode listar assuntos e leis de outras sessões: ignore o que não pertence ao tema. Trecho de lei que não trate do tema também fica de fora.
- Cite artigos SOMENTE dos trechos fornecidos, no formato do colchete (ex.: "CP, art. 312"). Se não houver trecho, não cite números de artigos.
- Não cite jurisprudência, súmulas, autores ou posições doutrinárias. Não invente leis, prazos ou números.
- Siga o texto da lei fornecido; ele é a versão vigente.
- ${full ? 'secoes: 3 a 6 seções, explicação didática com exemplos; perguntas: 5 a 8.' : 'secoes: até 3 seções curtas; perguntas: 5; foco em resumo e pontos de prova.'}
- legislacao: comente os artigos fornecidos mais importantes para a prova (ref exatamente como no colchete).
- pontos_banca e pegadinhas: o que costuma cair e as confusões comuns${p.banca ? ` da ${p.banca}` : ''}.
- ${board.length ? 'secoes[].como_banca_cobra: diga como as questões fornecidas abordam o assunto da seção (letra da lei, caso prático, conceito, exceção, tipo de distrator). Só o que se observa nelas: sem percentuais, sem "sempre" ou "nunca", sem copiar enunciados. Deixe vazio na seção que nenhuma questão trata. As questões são só amostra de estilo, nunca fonte do conteúdo.' : 'secoes[].como_banca_cobra: deixe vazio em todas as seções.'}
- Linguagem clara, frases curtas, sem markdown.`;
}

// Fontes legais da sessão: as leis citadas (com artigos) e os trechos carregados do banco.
export const sourceRef = (lawKey: string, label: string) => `${lawByKey(lawKey)?.short ?? lawKey}, art. ${label}`;

export interface ProvidedArticle { lawKey: string; label: string; num: number; suffix: string }

// Artigos citados no texto (ex.: "art. 312 do CP") que não caem nas fontes fornecidas.
export function unverifiedLawRefs(text: string, provided: ProvidedArticle[], subject = '') {
  const unverified: string[] = [];
  for (const r of findLawRefs(text, subject) as LawRef[]) {
    for (const range of r.ranges) {
      for (let n = range.from; n <= Math.min(range.to, range.from + 50); n++) {
        const ok = provided.some((p) => p.lawKey === r.law && p.num === n && inRanges([range], p.num, p.suffix));
        if (!ok) unverified.push(`${lawByKey(r.law)?.short ?? r.law}, art. ${n}`);
      }
    }
  }
  return [...new Set(unverified)];
}

// Confere as citações: refs da seção "legislacao" precisam ser fontes fornecidas; artigos citados no texto
// precisam cair nos intervalos fornecidos. Devolve as citações não verificáveis.
export function verifyGuide(g: Guide, provided: ProvidedArticle[], subject = '') {
  const refs = new Set(provided.map((p) => sourceRef(p.lawKey, p.label).toLowerCase()));
  const legislacao = g.legislacao.filter((l) => refs.has(l.ref.trim().toLowerCase()));
  const text = [g.introducao, ...g.secoes.flatMap((s) => [s.texto, ...s.exemplos, s.como_banca_cobra]), ...g.legislacao.map((l) => l.comentario), ...g.pontos_banca, ...g.pegadinhas, ...g.resumo, ...g.perguntas.flatMap((q) => [q.pergunta, q.resposta])].join('\n');
  return { guide: { ...g, legislacao }, unverified: unverifiedLawRefs(text, provided, subject), droppedRefs: g.legislacao.length - legislacao.length };
}

// Chave de reaproveitamento: mesmo tema, mesmas fontes, mesma profundidade e versão do prompt.
// O título da sessão entra porque um tópico do edital pode cobrir várias sessões com temas diferentes. Como a IA
// escreve títulos diferentes a cada cronograma, o reaproveitamento entre planos fica com pickSimilarGuide.
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const topicKeys = (topics: string[]) => [...new Set(topics.map(norm).filter(Boolean))].sort();
// Palavras do título que indicam o tema, sem artigos entre parênteses.
export const titleKeys = (title: string) => [...new Set(norm(title.replace(/\([^)]*\)/g, ' ')).split(' ').filter((w) => w.length > 3))].sort();
export const lawKeys = (law: GuideSource[]) => [...new Set(law.map((l) => l.ref))].sort();

export function guideCacheKey(p: { depth: GuideDepth; subject: string; title?: string; topics: string[]; law: GuideSource[]; banca: string }) {
  const s = JSON.stringify([GUIDE_PROMPT_VERSION, p.depth, norm(p.banca), norm(p.subject), titleKeys(p.title ?? ''), topicKeys(p.topics), p.law.map((l) => l.ref + '|' + l.text.length).sort()]);
  let h1 = 0x811c9dc5, h2 = 0;
  for (let i = 0; i < s.length; i++) { h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0; h2 = (h2 * 31 + s.charCodeAt(i)) >>> 0; }
  return `${h1.toString(16)}${h2.toString(16)}`;
}

// Semelhança entre conjuntos (0–1).
const jaccard = (a: string[], b: string[]) => {
  if (!a.length && !b.length) return 1;
  const sb = new Set(b), inter = a.filter((x) => sb.has(x)).length;
  return inter / (a.length + b.length - inter);
};
// Apostila já existente que serve para este tema: mesmos artigos (≥ 80%) e tópicos parecidos (≥ 50%);
// sem lei, os tópicos precisam coincidir (≥ 80%). Devolve o índice da melhor ou -1.
export function pickSimilarGuide(target: { title?: string; topics: string[]; law: string[] }, candidates: { title?: string; topic_keys: string[]; sources: string[] }[]) {
  let best = -1, bestScore = 0;
  const title = titleKeys(target.title ?? '');
  candidates.forEach((c, i) => {
    const t = jaccard(target.topics, c.topic_keys), l = jaccard(target.law, c.sources), n = jaccard(title, titleKeys(c.title ?? ''));
    const ok = n >= 0.5 && (target.law.length ? l >= 0.8 && t >= 0.5 : !c.sources.length && t >= 0.8);
    const score = l * 2 + t + n;
    if (ok && score > bestScore) { best = i; bestScore = score; }
  });
  return best;
}

// Leis citadas no tema que não estão no registro (ex.: leis estaduais): a apostila avisa que não há texto oficial integrado.
export function unlistedLaws(text: string): string[] {
  const listed = new Set(findLawRefs(text).map((r) => lawByKey(r.law)?.short));
  const out = new Set<string>();
  for (const m of text.matchAll(/\bLei(?:\s+Complementar)?\s*(?:Estadual\s*)?(?:n[º°o.]*\s*)?(\d{1,2}\.?\d{3})(?:\s*\/\s*(\d{2,4}))?/gi)) {
    const label = `Lei ${m[1]}${m[2] ? '/' + m[2] : ''}`;
    if (!findLawRefs(m[0]).length && !listed.has(label)) out.add(label);
  }
  // "provimento" solto é forma de ingresso no cargo: como norma, vem com número ou órgão.
  for (const m of text.matchAll(/\b(Resolução|Regimento|Normas da Corregedoria|Provimento\s+(?:n[º°o.]*\s*\d|CG\b|\d))[^,;.)]{0,40}/gi)) out.add(m[0].trim());
  return [...out];
}
