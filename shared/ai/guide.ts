// Apostila da sessão gerada pela IA: schema, prompt versionado e verificação das citações legais.
// Fontes permitidas: o conteúdo do edital da sessão e os artigos oficiais fornecidos (lei seca).
import { z } from 'zod';
import { roleContext } from './plan.ts';
import { findLawRefs, inRanges, type LawRef } from '../legal/refs.ts';
import { lawByKey } from '../legal/registry.ts';

export const GUIDE_PROMPT_VERSION = 'guide-v4';
export type GuideDepth = 'completa' | 'revisao';

// Apostila como um professor especialista em concursos monta: objetivos, mapa do tema, seções com prioridade, quadros
// comparativos, o que memorizar, lei seca comentada, pegadinhas, resumo e questões de fixação no formato da banca.
export const Guide = z.object({
  titulo: z.string(),
  introducao: z.string().describe('Contexto e por que o tema importa para a prova, em até 4 frases.'),
  objetivos: z.array(z.string()).describe('O que o aluno saberá fazer ao final, em 3 a 5 itens curtos ("Diferenciar…", "Identificar…").'),
  esquema: z.array(z.object({ topico: z.string(), itens: z.array(z.string()) })).describe('Mapa do tema: 3 a 6 tópicos, cada um com 2 a 5 itens de poucas palavras.'),
  secoes: z.array(z.object({
    titulo: z.string(),
    prioridade: z.enum(['alta', 'media', 'baixa']).describe('Quanto o assunto da seção cai em prova deste cargo e banca.'),
    texto: z.string().describe('Explicação didática em parágrafos separados por linha em branco.'),
    exemplos: z.array(z.string()).describe('Exemplos práticos curtos.'),
    como_banca_cobra: z.string().describe('Como a banca cobra o assunto desta seção, pelo que se vê nas questões fornecidas, em até 2 frases. Vazio se nenhuma questão fornecida tratar dele.'),
  })),
  quadros: z.array(z.object({
    titulo: z.string(), colunas: z.array(z.string()).describe('2 a 4 colunas; a primeira é o critério de comparação.'),
    linhas: z.array(z.array(z.string())).describe('Cada linha com uma célula por coluna, em poucas palavras.'),
  })).describe('Quadros comparativos entre institutos, espécies ou prazos parecidos, que a banca costuma confundir.'),
  legislacao: z.array(z.object({ ref: z.string().describe('Exatamente como no colchete do trecho fornecido, ex.: "CP, art. 312".'), comentario: z.string() })),
  memorizar: z.array(z.string()).describe('Prazos, números, quóruns e listas que precisam ser decorados, tirados dos trechos de lei ou do edital.'),
  pontos_banca: z.array(z.string()).describe('O que a banca mais cobra neste tema.'),
  pegadinhas: z.array(z.string()),
  resumo: z.array(z.string()).describe('Revisão em tópicos curtos.'),
  questoes: z.array(z.object({
    enunciado: z.string(),
    alternativas: z.array(z.string()).describe('Alternativas sem a letra; vazio em questão de certo ou errado.'),
    gabarito: z.string().describe('Letra da alternativa correta (A, B…) ou C/E em certo ou errado.'),
    comentario: z.string().describe('Por que o gabarito está certo e o erro das outras, em até 3 frases.'),
  })).describe('Questões de fixação inéditas, no formato e no estilo da banca.'),
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

// Revisão curta (cerca de um terço da completa): o prompt pede estes tetos e `trimReview` os garante, também nas revisões
// já gravadas (cortadas ao servir). Sem questões de fixação: a revisão de teoria usa as questões reais da aba Questões.
// Medido em 2026-11-03: as revisões guide-v4 tinham 74% do tamanho da completa, quase metade em seções e questões.
export const REVIEW_LIMITS = {
  objetivos: 3, esquema: 4, secoes: 3, paragrafos: 2, textoChars: 700, exemplos: 1, quadros: 1, legislacao: 3, comentarioChars: 220,
  memorizar: 8, pontos_banca: 4, pegadinhas: 4, resumo: 8, questoes: 0, perguntas: 3, respostaChars: 250,
} as const;
// Corta no fim da última frase que cabe; sem frase que caiba pela metade, corta na palavra com reticências.
export function clipText(t: string, max: number) {
  if (t.length <= max) return t;
  const s = t.slice(0, max), end = Math.max(s.lastIndexOf('. '), s.lastIndexOf('.\n'), s.endsWith('.') ? s.length - 1 : -1);
  return end >= max / 2 ? s.slice(0, end + 1) : s.slice(0, s.lastIndexOf(' ') > 0 ? s.lastIndexOf(' ') : max).trimEnd() + '…';
}
export function trimReview<G extends Partial<Guide>>(g: G): G {
  const L = REVIEW_LIMITS, cut = <T,>(list: T[] | undefined, n: number) => list?.slice(0, n);
  return {
    ...g,
    objetivos: cut(g.objetivos, L.objetivos), esquema: cut(g.esquema, L.esquema),
    secoes: cut(g.secoes, L.secoes)?.map((s) => ({
      ...s, texto: clipText(s.texto.split(/\n\s*\n/).slice(0, L.paragrafos).join('\n\n'), L.textoChars), exemplos: cut(s.exemplos, L.exemplos) ?? [],
    })),
    quadros: cut(g.quadros, L.quadros), legislacao: cut(g.legislacao, L.legislacao)?.map((l) => ({ ...l, comentario: clipText(l.comentario, L.comentarioChars) })),
    memorizar: cut(g.memorizar, L.memorizar), pontos_banca: cut(g.pontos_banca, L.pontos_banca), pegadinhas: cut(g.pegadinhas, L.pegadinhas),
    resumo: cut(g.resumo, L.resumo), questoes: cut(g.questoes, L.questoes),
    perguntas: cut(g.perguntas, L.perguntas)?.map((p) => ({ ...p, resposta: clipText(p.resposta, L.respostaChars) })),
  };
}

// format: formato predominante da banca na matéria ('certo e errado' ou múltipla escolha), para as questões de fixação.
// duties/otherRoles: atribuições do cargo no edital e os outros cargos dele, para a apostila não descrever outro cargo.
export function guidePrompt(p: { depth: GuideDepth; banca: string; cargo: string; subject: string; title: string; topics: string[]; law: GuideSource[]; boardQuestions?: BoardQuestion[]; format?: string; duties?: string; otherRoles?: string[] }) {
  const full = p.depth === 'completa', board = p.boardQuestions ?? [], ce = /certo/i.test(p.format ?? '');
  return `Você é professor especialista em concursos públicos brasileiros, autor de material de cursinho que aprova. Escreva uma apostila ${full ? 'completa, para quem está começando o tema (cerca de 20 minutos de leitura antes de resolver questões)' : 'de revisão curta, para quem já estudou o tema (cerca de 8 minutos de leitura)'}.
Concurso: ${p.cargo || 'não informado'}${p.banca ? `, banca ${p.banca}` : ''}.
${roleContext(p.cargo, p.duties, p.otherRoles)}
Matéria: ${p.subject}
Tema da sessão: ${p.title}
Conteúdo do edital coberto: ${p.topics.join(' | ') || '—'}
${p.law.length ? `Trechos oficiais da lei (lei seca, única fonte legal permitida):\n${p.law.map((l) => `[${l.ref}] ${l.text}`).join('\n\n')}` : 'Nenhum trecho de lei foi fornecido para este tema.'}
${board.length ? `Questões reais da banca ${p.banca} sobre o tema (amostra, não o total):\n${board.map((q, i) => `Q${i + 1} (${[q.assunto, q.ano].filter(Boolean).join(', ')}): ${q.enunciado.slice(0, BOARD_TEXT_MAX)}${q.alternativas.length ? `\n${q.alternativas.map((a) => a.slice(0, BOARD_OPTION_MAX)).join(' | ')}` : ''}`).join('\n\n')}` : 'Nenhuma questão real da banca foi fornecida.'}
Regras obrigatórias:
- Quando o tema tratar do cargo (atribuições, rotina, conduta), use as atribuições do edital acima como base e não descreva funções de outros cargos. Sem atribuições informadas, fique no que o nome do cargo e o conteúdo do edital indicam, sem inventar funções.
- Escreva só sobre o "Tema da sessão", e dê à apostila um título sobre ele. O conteúdo do edital pode listar assuntos e leis de outras sessões: ignore o que não pertence ao tema. Trecho de lei que não trate do tema também fica de fora.
- Cite artigos SOMENTE dos trechos fornecidos, no formato do colchete (ex.: "CP, art. 312"). Se não houver trecho, não cite números de artigos.
- Não cite jurisprudência, súmulas, autores ou posições doutrinárias. Não invente leis, prazos ou números.
- Siga o texto da lei fornecido; ele é a versão vigente.
- Ordem didática: do conceito e da regra geral para as exceções e os detalhes; cada seção explica, dá exemplo prático e destaca o que a prova costuma perguntar. Priorize o que mais cai: seção de prioridade alta ganha mais texto, a de baixa só o essencial.
- ${full ? 'secoes: 3 a 6 seções; quadros: 1 ou 2; questoes: 4 ou 5; perguntas: 4 a 6.' : `Revisão curta: no máximo um terço do tamanho de uma apostila completa. introducao: 1 ou 2 frases; objetivos: ${REVIEW_LIMITS.objetivos}; esquema: até ${REVIEW_LIMITS.esquema} tópicos; secoes: até ${REVIEW_LIMITS.secoes}, cada uma com 1 ou 2 parágrafos curtos (até ${REVIEW_LIMITS.textoChars} caracteres no total) e no máximo 1 exemplo; quadros: 0 ou 1; legislacao: até ${REVIEW_LIMITS.legislacao} artigos, com comentário de 1 frase; memorizar: até ${REVIEW_LIMITS.memorizar}; pontos_banca e pegadinhas: até ${REVIEW_LIMITS.pontos_banca} cada; resumo: 5 a ${REVIEW_LIMITS.resumo} tópicos; questoes: vazio (a revisão usa questões reais); perguntas: ${REVIEW_LIMITS.perguntas}, com resposta de 1 ou 2 frases. Foco em resumo, memorizar e pontos de prova; não repita a mesma informação em seções, resumo e pontos de prova.`}
- objetivos e esquema: curtos; o esquema é o mapa mental do tema, na ordem das seções.
- quadros: compare só o que a banca costuma confundir (espécies, prazos, requisitos, diferenças entre institutos). Sem quadro se o tema não tiver o que comparar.
- memorizar: só números, prazos, quóruns e listas que estejam nos trechos de lei ou no conteúdo do edital, nunca de memória. Vazio se não houver.
- questoes${full ? '' : ' (só na apostila completa; aqui, vazio)'}: inéditas, ${ce ? 'no formato certo ou errado (alternativas vazias; gabarito "C" ou "E")' : 'de múltipla escolha com 5 alternativas (gabarito A a E)'}, no estilo ${board.length ? 'das questões reais fornecidas' : `da ${p.banca || 'banca'}`}, cobrando o que a apostila ensinou. Uma única resposta correta, sem ambiguidade; o comentário explica o gabarito pela apostila ou pelo artigo fornecido.
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
  const text = [
    g.introducao, ...(g.objetivos ?? []), ...(g.esquema ?? []).flatMap((e) => [e.topico, ...e.itens]), ...g.secoes.flatMap((s) => [s.texto, ...s.exemplos, s.como_banca_cobra]),
    ...(g.quadros ?? []).flatMap((q) => q.linhas.flat()), ...g.legislacao.map((l) => l.comentario), ...(g.memorizar ?? []), ...g.pontos_banca, ...g.pegadinhas, ...g.resumo,
    ...(g.questoes ?? []).flatMap((q) => [q.enunciado, ...q.alternativas, q.comentario]), ...g.perguntas.flatMap((q) => [q.pergunta, q.resposta]),
  ].join('\n');
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

// Tema que depende do cargo (atribuições, rotina, funções): a apostila é do cargo e não serve para outro, mesmo com o mesmo tema.
export const roleSpecific = (p: { title?: string; topics: string[] }) => /atribui|do cargo|da fun[cç][aã]o|rotina funcional/i.test([p.title ?? '', ...p.topics].join(' '));

export function guideCacheKey(p: { depth: GuideDepth; subject: string; title?: string; topics: string[]; law: GuideSource[]; banca: string; cargo?: string }) {
  const s = JSON.stringify([GUIDE_PROMPT_VERSION, p.depth, norm(p.banca), norm(p.subject), titleKeys(p.title ?? ''), topicKeys(p.topics), p.law.map((l) => l.ref + '|' + l.text.length).sort(),
    ...(roleSpecific(p) ? [norm(p.cargo ?? '')] : [])]);
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
