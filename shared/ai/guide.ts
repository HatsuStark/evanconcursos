// Apostila da sessão gerada pela IA: schema, prompt versionado e verificação das citações legais.
// Fontes permitidas: o conteúdo do edital da sessão e os artigos oficiais fornecidos (lei seca).
import { z } from 'zod';
import { MARK_RULE, missingMark } from './marks.ts';
import { roleContext } from './plan.ts';
import { type Court, type PrecedentKind, unverifiedPrecedents } from '../legal/juris.ts';
import { findLawRefs, inRanges, type LawRef } from '../legal/refs.ts';
import { lawByKey, type LawEntry } from '../legal/registry.ts';

// v5 (e review-v2, deep-v2): linguagem de professor explicando em aula, com todo termo técnico traduzido.
export const GUIDE_PROMPT_VERSION = 'guide-v5';
// Revisão curta com versão própria: folha de memorização (mapa mental, mnemônicos, gatilhos), sem texto corrido nem
// questões. Mudar só a revisão não refaz as apostilas completas.
export const REVIEW_PROMPT_VERSION = 'review-v2';
// Aprofundamento: para quem já estudou o tema; mesmo formato da completa, sem repetir o básico.
export const DEEP_PROMPT_VERSION = 'deep-v2';
export const guideVersion = (depth: GuideDepth) => (depth === 'revisao' ? REVIEW_PROMPT_VERSION : depth === 'aprofundamento' ? DEEP_PROMPT_VERSION : GUIDE_PROMPT_VERSION);
export type GuideDepth = 'completa' | 'revisao' | 'aprofundamento';

// Apostila como um professor especialista em concursos monta: objetivos, mapa do tema, seções com prioridade, quadros
// comparativos, o que memorizar, lei seca comentada, pegadinhas, resumo e questões de fixação no formato da banca.
export const Guide = z.object({
  titulo: z.string(),
  introducao: z.string().describe('Contexto e por que o tema importa para a prova, em até 4 frases.'),
  objetivos: z.array(z.string()).describe('O que o aluno saberá fazer ao final, em 3 a 5 itens curtos ("Diferenciar…", "Identificar…").'),
  esquema: z.array(z.object({ topico: z.string(), itens: z.array(z.string()) })).describe('Mapa do tema (mapa mental): 3 a 6 ramos, cada um com 2 a 5 palavras-chave.'),
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
  mnemonicos: z.array(z.object({
    alvo: z.string().describe('O que o mnemônico ajuda a lembrar (lista, requisitos, ordem, prazos).'),
    mnemonico: z.string().describe('Sigla, palavra ou frase curta fácil de lembrar.'),
    explicacao: z.string().describe('Como decifrar: cada letra ou palavra e o item que representa.'),
  })).describe('Mnemônicos para as listas e sequências do tema. Vazio se nada pede mnemônico.'),
  gatilhos: z.array(z.object({
    pista: z.string().describe('Palavra ou situação que aparece no enunciado ("se a questão falar em…").'),
    resposta: z.string().describe('O que lembrar na hora, em poucas palavras.'),
  })).describe('Associações rápidas entre pistas do enunciado e a resposta.'),
  pontos_banca: z.array(z.string()).describe('O que a banca mais cobra neste tema.'),
  pegadinhas: z.array(z.string()),
  resumo: z.array(z.string()).describe('Revisão em tópicos curtos.'),
  questoes: z.array(z.object({
    enunciado: z.string().describe('Trecho chamado de "destacado" no comando vai entre **duplo asterisco**.'),
    alternativas: z.array(z.string()).describe('Alternativas sem a letra; vazio em questão de certo ou errado.'),
    gabarito: z.string().describe('Letra da alternativa correta (A, B…) ou C/E em certo ou errado.'),
    comentario: z.string().describe('Por que o gabarito está certo e o erro das outras, em até 3 frases.'),
  })).describe('Questões de fixação inéditas, no formato e no estilo da banca.'),
  perguntas: z.array(z.object({ pergunta: z.string(), resposta: z.string() })),
  depende_legislacao: z.boolean().describe('true se o conteúdo depende de lei que pode ser alterada.'),
});
export type Guide = z.infer<typeof Guide>;
export const guideJsonSchema = () => z.toJSONSchema(Guide, { target: 'draft-7' });

// Completa e aprofundamento saem em duas chamadas em paralelo, cada uma com metade da escrita: o texto (começa na hora e
// aparece na tela assim que fica pronto) e a prática (questões, revisão e "como a banca cobra"), que começa quando as
// questões da banca chegam. As duas partem das mesmas fontes (edital e lei), então a prática cobra o que o texto ensina.
// O tempo é quase todo de escrita: numa chamada só, ~4.500 tokens de saída, 45 a 85 s (guide-v4, 2026-11-04).
const Secao = Guide.shape.secoes.element;
export const GuideText = Guide.pick({ titulo: true, introducao: true, objetivos: true, esquema: true, quadros: true, legislacao: true })
  .extend({ secoes: z.array(Secao.omit({ como_banca_cobra: true })) });
export type GuideText = z.infer<typeof GuideText>;
export const GuidePractice = Guide.pick({ memorizar: true, pontos_banca: true, pegadinhas: true, resumo: true, questoes: true, perguntas: true, depende_legislacao: true })
  .extend({ cobranca: z.array(z.object({ assunto: z.string().describe('Assunto do tema, em poucas palavras (ex.: "citação por hora certa").'), como: z.string() }))
    .describe('Como a banca cobra cada assunto do tema, pelo que se vê nas questões fornecidas, em até 2 frases por assunto. Só assuntos que alguma questão trata; vazio sem questões.') });
export type GuidePractice = z.infer<typeof GuidePractice>;
export const guideTextJsonSchema = () => z.toJSONSchema(GuideText, { target: 'draft-7' });

// ---------- escrita em partes (completa e aprofundamento) ----------
// O tempo é quase todo de escrita (~150 tokens/s): o texto inteiro numa chamada levava 30 s ou mais antes de aparecer.
// Primeiro um roteiro curto (título, introdução, objetivos, mapa e a lista de seções com o que cada uma cobre), que aparece
// na hora; depois, em paralelo, a 1ª seção sozinha (para o aluno começar logo), as demais em dois grupos e os quadros com
// a lei comentada. O roteiro vai em todas as chamadas, para as seções não repetirem nem deixarem buraco.
export const GuideOutline = Guide.pick({ titulo: true, introducao: true, objetivos: true, esquema: true }).extend({
  secoes: z.array(z.object({
    titulo: z.string(),
    prioridade: Secao.shape.prioridade,
    cobre: z.string().describe('O que a seção explica, em 1 frase: os pontos e os artigos dela.'),
  })).describe('3 a 6 seções, na ordem didática.'),
});
export type GuideOutline = z.infer<typeof GuideOutline>;
export const GuideSections = z.object({ secoes: z.array(Secao.pick({ titulo: true, texto: true, exemplos: true })).describe('Só as seções pedidas, na ordem pedida.') });
export type GuideSections = z.infer<typeof GuideSections>;
export const GuideExtras = GuideText.pick({ quadros: true, legislacao: true });
export type GuideExtras = z.infer<typeof GuideExtras>;
export const guideOutlineJsonSchema = () => z.toJSONSchema(GuideOutline, { target: 'draft-7' });
export const guideSectionsJsonSchema = () => z.toJSONSchema(GuideSections, { target: 'draft-7' });
export const guideExtrasJsonSchema = () => z.toJSONSchema(GuideExtras, { target: 'draft-7' });

// A 1ª seção sozinha; as demais em até dois grupos, para nenhum ficar muito maior que o outro.
export function sectionGroups(n: number): number[][] {
  if (n <= 0) return [];
  const rest = Array.from({ length: n - 1 }, (_, i) => i + 1), half = Math.ceil(rest.length / 2);
  return [[0], rest.slice(0, half), rest.slice(half)].filter((g) => g.length);
}

const outlineText = (o: GuideOutline) => o.secoes.map((x, i) => `${i + 1}. ${x.titulo} (prioridade ${x.prioridade}): ${x.cobre}`).join('\n');
export function guideStage(step: { kind: 'roteiro' } | { kind: 'secoes'; outline: GuideOutline; indices: number[] } | { kind: 'extras'; outline: GuideOutline }): string {
  if (step.kind === 'roteiro') return 'Nesta etapa, faça só o roteiro da apostila: título, introdução, objetivos, mapa mental e a lista de seções, cada uma com título, prioridade e o que ela cobre em 1 frase (com os artigos dela, se houver). Não escreva o texto das seções: ele vem nas etapas seguintes, a partir deste roteiro.';
  const roteiro = `Roteiro já definido da apostila "${step.outline.titulo}":\n${outlineText(step.outline)}`;
  if (step.kind === 'extras') return `${roteiro}\nNesta etapa, faça só os quadros comparativos e a lei seca comentada desse tema. As seções são escritas em separado.`;
  const wanted = step.indices.map((i) => `${i + 1}. ${step.outline.secoes[i]!.titulo}`).join('; ');
  return `${roteiro}\nNesta etapa, escreva só ${step.indices.length === 1 ? 'a seção' : 'as seções'} ${wanted}, com o título exatamente como no roteiro: texto e exemplos, cobrindo o que o roteiro diz. Tamanho de seção de apostila: 2 a 4 parágrafos curtos e 1 ou 2 exemplos; seção de prioridade baixa, 1 ou 2 parágrafos. As outras seções são escritas em separado: não escreva o conteúdo delas nem o repita.${step.indices[0] === 0 ? ' Esta é a primeira seção: comece da base do tema.' : ''}`;
}

// Junta o roteiro com o que já foi escrito: seção sem texto ainda é pendente.
export function textFromOutline(o: GuideOutline): GuideText {
  return { titulo: o.titulo, introducao: o.introducao, objetivos: o.objetivos, esquema: o.esquema, quadros: [], legislacao: [],
    secoes: o.secoes.map((x) => ({ titulo: x.titulo, prioridade: x.prioridade, texto: '', exemplos: [] })) };
}

// Revisão curta em duas metades paralelas, cada uma com a metade dos campos.
export const REVIEW_HALVES = [
  { fields: ['titulo', 'introducao', 'esquema', 'memorizar', 'mnemonicos', 'gatilhos'], label: 'título, introdução, mapa mental, o que memorizar, mnemônicos e gatilhos de prova' },
  { fields: ['quadros', 'legislacao', 'pontos_banca', 'pegadinhas', 'resumo', 'perguntas'], label: 'quadro, lei seca comentada, o que mais cai, pegadinhas, resumo e perguntas de recordação' },
] as const;
// Cada metade tem o próprio schema, só com os seus campos: pedir "deixe vazios os outros" não bastava (a IA escrevia a
// revisão inteira nas duas e não ganhava tempo).
export const ReviewHalves = [
  Guide.pick({ titulo: true, introducao: true, esquema: true, memorizar: true, mnemonicos: true, gatilhos: true }),
  Guide.pick({ quadros: true, legislacao: true, pontos_banca: true, pegadinhas: true, resumo: true, perguntas: true, depende_legislacao: true }),
] as const;
export const reviewHalfJsonSchema = (half: 0 | 1) => z.toJSONSchema(ReviewHalves[half], { target: 'draft-7' });
export const reviewStage = (half: 0 | 1) => `Nesta etapa, preencha só: ${REVIEW_HALVES[half].label}. O resto da revisão é feito em separado.`;
// Junta as duas metades: cada campo vem da metade responsável por ele.
export function mergeReviewHalves(a: Partial<Guide>, b: Partial<Guide>): Guide {
  const pick = (g: Partial<Guide>, half: 0 | 1) => Object.fromEntries(REVIEW_HALVES[half].fields.map((f) => [f, g[f as keyof Guide]]));
  return { titulo: '', introducao: '', objetivos: [], esquema: [], secoes: [], quadros: [], legislacao: [], memorizar: [], mnemonicos: [], gatilhos: [], pontos_banca: [], pegadinhas: [],
    resumo: [], questoes: [], perguntas: [], depende_legislacao: !!(a.depende_legislacao || b.depende_legislacao), ...pick(a, 0), ...pick(b, 1) } as Guide;
}
export const guidePracticeJsonSchema = () => z.toJSONSchema(GuidePractice, { target: 'draft-7' });

// Prática ainda chegando: os campos dela vazios, e `parcial` avisa a tela para continuar esperando. `pendentes`: seções do
// roteiro ainda sendo escritas (a tela mostra o título com "escrevendo").
export function partialGuide(t: GuideText, pendentes: number[] = []): Guide & { parcial: true; pendentes?: number[] } {
  return { ...t, secoes: t.secoes.map((x) => ({ ...x, como_banca_cobra: '' })), memorizar: [], mnemonicos: [], gatilhos: [], pontos_banca: [], pegadinhas: [], resumo: [],
    questoes: [], perguntas: [], depende_legislacao: false, parcial: true, ...(pendentes.length ? { pendentes } : {}) };
}
// Cada "como a banca cobra" vai para a seção que mais compartilha palavras com o assunto (título pesa em dobro); sem
// palavra em comum, fica de fora. Uma seção recebe no máximo um.
const words = (t: string) => new Set(t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4));
export function mergeGuide(t: GuideText, p: GuidePractice): Guide {
  const { cobranca, ...rest } = p;
  const como: string[] = t.secoes.map(() => '');
  for (const c of cobranca) {
    const w = words(c.assunto);
    const score = t.secoes.map((x, i) => (como[i] ? -1 : 2 * [...words(x.titulo)].filter((y) => w.has(y)).length + [...words(x.texto)].filter((y) => w.has(y)).length));
    const best = score.indexOf(Math.max(...score));
    if (best >= 0 && score[best]! > 0) como[best] = c.como.trim();
  }
  // Questão que fala em termo destacado sem marcar nenhum não tem como ser respondida: sai.
  return { ...t, ...rest, questoes: rest.questoes.filter((q) => !missingMark(q.enunciado)), mnemonicos: [], gatilhos: [], secoes: t.secoes.map((x, i) => ({ ...x, como_banca_cobra: como[i]! })) };
}

export interface GuideSource { ref: string; text: string }
// Jurisprudência oficial fornecida à apostila (nível superior): ref é o rótulo citável ("Súmula 17/STJ").
export interface GuideJuris extends GuideSource { court: Court; kind: PrecedentKind; number: number }
export const MAX_GUIDE_JURIS = 6;
// Trechos de obras de licença aberta (matérias sem lei): referência de conteúdo; ref = "Guia do Writer 7.1, p. 45".
export const MAX_GUIDE_FONTES = 3;

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

// Revisão curta (review-v1): folha de memorização para quem já estudou o tema. Mapa mental, mnemônicos, gatilhos de
// prova, o que memorizar, pegadinhas, resumo e perguntas de recordação; sem seções de texto e sem questões de fixação (a
// revisão de teoria usa as questões reais da aba Questões). O prompt pede estes tetos e `trimReview` os garante.
// Medido em 2026-11-03: as revisões guide-v4 tinham 74% do tamanho da completa, quase metade em seções e questões.
export const REVIEW_LIMITS = {
  objetivos: 0, esquema: 6, ramoItens: 4, secoes: 0, paragrafos: 2, textoChars: 700, exemplos: 1, quadros: 1, legislacao: 3, comentarioChars: 220,
  memorizar: 8, mnemonicos: 3, gatilhos: 6, pontos_banca: 4, pegadinhas: 4, resumo: 8, questoes: 0, perguntas: 3, respostaChars: 250,
} as const;
// Corta no fim da última frase que cabe; sem frase que caiba pela metade, corta na palavra com reticências.
export function clipText(t: string, max: number) {
  if (t.length <= max) return t;
  const s = t.slice(0, max), end = Math.max(s.lastIndexOf('. '), s.lastIndexOf('.\n'), s.endsWith('.') ? s.length - 1 : -1);
  return end >= max / 2 ? s.slice(0, end + 1) : s.slice(0, s.lastIndexOf(' ') > 0 ? s.lastIndexOf(' ') : max).trimEnd() + '…';
}
// A tela e a voz já mostram "pista → resposta": tira o "se a questão falar em" que a IA às vezes repete na pista.
export const cuePista = (t: string) => {
  const s = t.replace(/^\s*se\s+(a\s+questão|o\s+enunciado|a\s+assertiva)\s+(falar|mencionar|disser|trouxer|citar)\s+(em\s+|que\s+)?/i, '').trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : t;
};
export function trimReview<G extends Partial<Guide>>(g: G): G {
  const L = REVIEW_LIMITS, cut = <T,>(list: T[] | undefined, n: number) => list?.slice(0, n);
  return {
    ...g,
    objetivos: cut(g.objetivos, L.objetivos), esquema: cut(g.esquema, L.esquema)?.map((e) => ({ ...e, itens: e.itens.slice(0, L.ramoItens) })),
    secoes: cut(g.secoes, L.secoes)?.map((s) => ({
      ...s, texto: clipText(s.texto.split(/\n\s*\n/).slice(0, L.paragrafos).join('\n\n'), L.textoChars), exemplos: cut(s.exemplos, L.exemplos) ?? [],
    })),
    quadros: cut(g.quadros, L.quadros), legislacao: cut(g.legislacao, L.legislacao)?.map((l) => ({ ...l, comentario: clipText(l.comentario, L.comentarioChars) })),
    memorizar: cut(g.memorizar, L.memorizar), mnemonicos: cut(g.mnemonicos, L.mnemonicos), gatilhos: cut(g.gatilhos, L.gatilhos)?.map((x) => ({ ...x, pista: cuePista(x.pista) })), pontos_banca: cut(g.pontos_banca, L.pontos_banca), pegadinhas: cut(g.pegadinhas, L.pegadinhas),
    resumo: cut(g.resumo, L.resumo), questoes: cut(g.questoes, L.questoes),
    perguntas: cut(g.perguntas, L.perguntas)?.map((p) => ({ ...p, resposta: clipText(p.resposta, L.respostaChars) })),
  };
}

const FULL_TEXT = `- Ordem didática: do conceito e da regra geral para as exceções e os detalhes; cada seção explica, dá exemplo prático e destaca o que a prova costuma perguntar. Priorize o que mais cai: seção de prioridade alta ganha mais texto, a de baixa só o essencial.
- secoes: 3 a 6 seções; quadros: 1 ou 2.
- objetivos e esquema: curtos; o esquema é o mapa mental do tema, na ordem das seções.`;
const FULL_PRACTICE = `- questoes: 4 ou 5; perguntas: 4 a 6.`;
const DEEP_TEXT = `- Aprofundamento: o aluno já estudou o tema e resolveu questões. Não repita definições nem a regra geral: no máximo uma frase de lembrete por seção.
- secoes: 3 a 5, sobre o que separa quem acerta de quem erra: exceções e ressalvas, distinções finas entre institutos parecidos, prazos e sujeitos que a banca troca, casos práticos em que a regra geral não se aplica, combinação de artigos. Cada seção traz pelo menos um exemplo de caso difícil resolvido.
- quadros: 1 ou 2, comparando o que a banca costuma confundir.
- objetivos e esquema: curtos.`;
const DEEP_PRACTICE = `- Aprofundamento: o aluno já estudou o tema e resolveu questões. pegadinhas: 5 a 8, cada uma com a troca exata que a banca faz.
- questoes: 5, de dificuldade difícil, cada uma cobrando uma exceção, distinção ou caso prático diferente; distratores que trocam um único detalhe do texto da lei.
- perguntas: 4 a 6, de recordação ativa sobre as exceções e distinções.`;
// Tom de professor explicando em aula, para quem nunca estudou o assunto. O termo técnico fica (a prova usa), mas
// sempre traduzido. Na revisão curta, os itens continuam de uma linha.
const VOICE_RULES = `Linguagem (obrigatório):
- Escreva como um professor explicando em aula para um aluno que nunca estudou o assunto: fale com o aluno ("você"), em tom próximo e encorajador, como numa conversa, sem gíria.
- Explique primeiro a ideia com palavras do dia a dia e só depois dê o nome técnico. Todo termo técnico, na primeira vez que aparece, vem com o significado em palavras simples (ex.: "citação, que é o ato de avisar oficialmente a pessoa de que existe um processo contra ela"). Mantenha os termos técnicos, porque a prova usa, mas nunca sem tradução.
- Ao comentar um artigo, diga primeiro o que ele quer dizer, como quem traduz para o aluno ("Na prática, o artigo diz que…"), e depois o detalhe que cai na prova.
- Use exemplos concretos, com pessoas e situações do dia a dia ou da rotina do cargo ("Imagine que o oficial de justiça chega à casa de Maria…").
- Frases curtas e na ordem direta (quem faz o quê), um assunto por parágrafo. Nada de juridiquês ou palavra rebuscada ("outrossim", "destarte", "consoante", "ex vi", "mister", "hodiernamente") nem latim sem tradução.
- Antecipe a dúvida do aluno e responda ("E se a pessoa não estiver em casa? Aí…"), e ligue as partes ("Agora que você entendeu a regra, vamos às exceções").
- Simplificar a linguagem nunca muda o conteúdo: prazos, números, sujeitos e exceções continuam exatos, como no texto da lei.`;
const REVIEW_VOICE = `Linguagem (obrigatório): cada item continua curto, de uma linha, mas em palavras simples, como o professor resumiria no quadro. Termo técnico vem com o significado em poucas palavras quando não for óbvio (ex.: "citação = aviso oficial do processo"). Nada de juridiquês. Prazos, números e exceções exatos, como na lei.`;
const L = REVIEW_LIMITS;
const REVIEW_RULES = `- Revisão curta: nada de texto corrido nem questões de fixação. Cada item cabe numa linha. Não repita a mesma informação em campos diferentes.
- introducao: 1 frase. objetivos, secoes e questoes: vazios.
- esquema: o mapa mental do tema, com 4 a ${L.esquema} ramos (topico = nome curto do ramo) e 2 a ${L.ramoItens} palavras-chave por ramo, de até 5 palavras cada. Os ramos seguem a lógica do tema (conceito, espécies, requisitos, exceções, prazos, consequências).
- mnemonicos: 1 a ${L.mnemonicos}, só para listas, requisitos, ordens ou prazos que estejam nos trechos de lei ou no conteúdo do edital. Prefira siglas ou frases já usadas por concurseiros quando existirem; senão, crie uma curta e fácil de lembrar. A explicacao decifra cada letra ou palavra. Nunca force: sem lista ou sequência que peça mnemônico, deixe vazio.
- gatilhos: 4 a ${L.gatilhos} associações rápidas entre uma pista que aparece no enunciado (só a pista, sem "se a questão falar em") e o que lembrar (ex.: pista "funcionário se apropria de bem que tem a posse em razão do cargo", resposta "peculato-apropriação").
- memorizar: até ${L.memorizar} itens. quadros: 0 ou 1, enxuto. legislacao: até ${L.legislacao} artigos-chave, com comentário de 1 frase.
- pontos_banca e pegadinhas: até ${L.pontos_banca} cada. resumo: 5 a ${L.resumo} tópicos.
- perguntas: ${L.perguntas} perguntas de recordação ativa (o aluno tenta responder de cabeça), com resposta de 1 frase.`;

// format: formato predominante da banca na matéria ('certo e errado' ou múltipla escolha), para as questões de fixação.
// duties/otherRoles: atribuições do cargo no edital e os outros cargos dele, para a apostila não descrever outro cargo.
// part: na completa e no aprofundamento, 'texto' (sem as questões da banca) ou 'pratica'; a revisão curta sai numa
// chamada só.
// stage: instrução da etapa quando o texto é escrito em partes (guideStage, reviewStage); substitui a da parte.
export function guidePrompt(p: { depth: GuideDepth; banca: string; cargo: string; subject: string; title: string; topics: string[]; law: GuideSource[]; juris?: GuideJuris[]; fontes?: GuideSource[]; boardQuestions?: BoardQuestion[]; format?: string; duties?: string; otherRoles?: string[]; part?: 'texto' | 'pratica'; stage?: string; notes?: string[] }) {
  const full = p.depth !== 'revisao', deep = p.depth === 'aprofundamento', board = p.boardQuestions ?? [], ce = /certo/i.test(p.format ?? '');
  const juris = p.juris ?? [], fontes = p.fontes ?? [];
  const texto = !full || p.part !== 'pratica', pratica = !full || p.part !== 'texto';
  const step = p.stage ? p.stage : !full ? '' : p.part === 'texto'
    ? 'Nesta parte, escreva só o texto da apostila (título, introdução, objetivos, mapa, seções, quadros e lei comentada). Questões de fixação, perguntas, pegadinhas e o resto são feitos em separado.'
    : p.part === 'pratica' ? 'Nesta parte, o texto explicativo é feito em separado: monte só a prática e a revisão do tema (o que memorizar, o que mais cai, pegadinhas, resumo, questões de fixação, perguntas e como a banca cobra cada assunto), cobrindo os pontos principais do tema e dos trechos de lei.' : '';
  return `Você é professor especialista em concursos públicos brasileiros, autor de material de cursinho que aprova. ${deep ? 'Escreva o aprofundamento do tema para quem já estudou a base e quer subir o acerto (cerca de 20 minutos de leitura antes de questões difíceis).' : full ? 'Escreva uma apostila completa, para quem está começando o tema (cerca de 20 minutos de leitura antes de resolver questões).' : 'Monte a revisão curta do tema: uma folha de memorização para quem já estudou (cerca de 5 minutos), sem texto corrido.'}${step ? ` ${step}` : ''}
Concurso: ${p.cargo || 'não informado'}${p.banca ? `, banca ${p.banca}` : ''}.
${roleContext(p.cargo, p.duties, p.otherRoles)}
Matéria: ${p.subject}
Tema da sessão: ${p.title}
Item do edital de onde o tema saiu (só contexto; pode citar assuntos de outras sessões): ${p.topics.join(' | ') || '—'}
${p.law.length ? `Trechos oficiais da lei (lei seca, única fonte legal permitida):\n${p.law.map((l) => `[${l.ref}] ${l.text}`).join('\n\n')}` : 'Nenhum trecho de lei foi fornecido para este tema.'}
${juris.length ? `Jurisprudência oficial do STF e do STJ sobre esses artigos (texto publicado pelo tribunal; única jurisprudência permitida):\n${juris.map((j) => `[${j.ref}] ${j.text}`).join('\n\n')}` : ''}
${fontes.length ? `Trechos de obras de licença aberta sobre o tema (referência de conteúdo):\n${fontes.map((f) => `[${f.ref}] ${f.text}`).join('\n\n')}` : ''}
${(p.notes ?? []).filter(Boolean).join('\n')}
${p.part === 'texto' ? '' : board.length ? `Questões reais da banca ${p.banca} sobre o tema (amostra, não o total):\n${board.map((q, i) => `Q${i + 1} (${[q.assunto, q.ano].filter(Boolean).join(', ')}): ${q.enunciado.slice(0, BOARD_TEXT_MAX)}${q.alternativas.length ? `\n${q.alternativas.map((a) => a.slice(0, BOARD_OPTION_MAX)).join(' | ')}` : ''}`).join('\n\n')}` : 'Nenhuma questão real da banca foi fornecida.'}
Regras obrigatórias:
- Quando o tema tratar do cargo (atribuições, rotina, conduta), use as atribuições do edital acima como base e não descreva funções de outros cargos. Sem atribuições informadas, fique no que o nome do cargo e o conteúdo do edital indicam, sem inventar funções.
- Escreva só sobre o "Tema da sessão", e dê à apostila um título sobre ele. O item do edital costuma ser maior que o tema (ex.: tema "Substantivos e adjetivos" num item que cita todas as classes de palavras) e pode listar assuntos e leis de outras sessões: ignore o que não pertence ao tema. Trecho de lei que não trate do tema também fica de fora.
- Cite artigos SOMENTE dos trechos fornecidos, no formato do colchete (ex.: "CP, art. 312"). Se não houver trecho, não cite números de artigos.
${juris.length
    ? '- Jurisprudência: cite SOMENTE os itens fornecidos, pelo nome do colchete (ex.: "Súmula 17/STJ"), onde explicarem o assunto da seção, e no comentário do artigo a que se referem. Reproduza o sentido do enunciado sem acrescentar regras nem exceções. Não cite outras súmulas, teses, julgados, autores ou posições doutrinárias. Não invente leis, prazos ou números.'
    : '- Não cite jurisprudência, súmulas, autores ou posições doutrinárias. Não invente leis, prazos ou números.'}
- Siga o texto da lei fornecido; ele é a versão vigente.
${fontes.length ? '- Trechos de obras abertas: use como referência do conteúdo e, quando divergirem da sua memória, siga os trechos. Explique com suas palavras, sem copiar frases, e cite a obra no formato do colchete (ex.: "Guia do Writer 7.1, p. 45") onde seguir uma explicação dela.' : ''}
${!full ? REVIEW_RULES : [texto && (deep ? DEEP_TEXT : FULL_TEXT), pratica && (deep ? DEEP_PRACTICE : FULL_PRACTICE)].filter(Boolean).join('\n')}
${full ? VOICE_RULES : REVIEW_VOICE}
${texto ? '- quadros: compare só o que a banca costuma confundir (espécies, prazos, requisitos, diferenças entre institutos). Sem quadro se o tema não tiver o que comparar.' : ''}
${pratica ? '- memorizar: só números, prazos, quóruns e listas que estejam nos trechos de lei ou no conteúdo do edital, nunca de memória. Vazio se não houver.' : ''}
${full && pratica ? `- questoes: inéditas, ${ce ? 'no formato certo ou errado (alternativas vazias; gabarito "C" ou "E")' : 'de múltipla escolha com 5 alternativas (gabarito A a E)'}, no estilo ${board.length ? 'das questões reais fornecidas' : `da ${p.banca || 'banca'}`}, cobrando os pontos principais do tema. Uma única resposta correta, sem ambiguidade; o comentário explica o gabarito pela apostila ou pelo artigo fornecido. ${MARK_RULE}` : ''}
${texto ? '- legislacao: comente os artigos fornecidos mais importantes para a prova (ref exatamente como no colchete).' : ''}
${pratica ? `- pontos_banca e pegadinhas: o que costuma cair e as confusões comuns${p.banca ? ` da ${p.banca}` : ''}.` : ''}
- ${!full ? 'secoes: vazio.' : p.part === 'texto' ? 'secoes: só título, prioridade, texto e exemplos (o "como a banca cobra" vem na etapa seguinte).' : board.length ? `${p.part === 'pratica' ? 'cobranca' : 'secoes[].como_banca_cobra'}: diga como as questões fornecidas abordam ${p.part === 'pratica' ? 'cada assunto' : 'o assunto da seção'} (letra da lei, caso prático, conceito, exceção, tipo de distrator). Só o que se observa nelas: sem percentuais, sem "sempre" ou "nunca", sem copiar enunciados. Deixe de fora o que nenhuma questão trata. As questões são só amostra de estilo, nunca fonte do conteúdo.` : `${p.part === 'pratica' ? 'cobranca' : 'secoes[].como_banca_cobra'}: deixe vazio.`}
- Sem markdown.`.replace(/\n{2,}/g, '\n');
}

// Fontes legais da sessão: as leis citadas (com artigos) e os trechos carregados do banco.
// `extra`: normas enviadas pelo estudante (PDF), que valem como leis do registro para ele.
export const sourceRef = (lawKey: string, label: string, extra: LawEntry[] = []) => `${lawByKey(lawKey, extra)?.short ?? lawKey}, art. ${label}`;

export interface ProvidedArticle { lawKey: string; label: string; num: number; suffix: string }

// Artigos citados no texto (ex.: "art. 312 do CP") que não caem nas fontes fornecidas.
export function unverifiedLawRefs(text: string, provided: ProvidedArticle[], subject = '', extra: LawEntry[] = []) {
  const unverified: string[] = [];
  for (const r of findLawRefs(text, subject, extra) as LawRef[]) {
    for (const range of r.ranges) {
      for (let n = range.from; n <= Math.min(range.to, range.from + 50); n++) {
        const ok = provided.some((p) => p.lawKey === r.law && p.num === n && inRanges([range], p.num, p.suffix));
        if (!ok) unverified.push(`${lawByKey(r.law, extra)?.short ?? r.law}, art. ${n}`);
      }
    }
  }
  return [...new Set(unverified)];
}

// Confere as citações: refs da seção "legislacao" precisam ser fontes fornecidas; artigos citados no texto
// precisam cair nos intervalos fornecidos. Devolve as citações não verificáveis.
export function verifyGuide(g: Guide, provided: ProvidedArticle[], subject = '', extra: LawEntry[] = [], juris: GuideJuris[] = []) {
  const refs = new Set(provided.map((p) => sourceRef(p.lawKey, p.label, extra).toLowerCase()));
  const legislacao = g.legislacao.filter((l) => refs.has(l.ref.trim().toLowerCase()));
  const text = [
    g.introducao, ...(g.objetivos ?? []), ...(g.esquema ?? []).flatMap((e) => [e.topico, ...e.itens]), ...g.secoes.flatMap((s) => [s.texto, ...s.exemplos, s.como_banca_cobra]),
    ...(g.quadros ?? []).flatMap((q) => q.linhas.flat()), ...g.legislacao.map((l) => l.comentario), ...(g.memorizar ?? []), ...(g.mnemonicos ?? []).flatMap((m) => [m.alvo, m.mnemonico, m.explicacao]),
    ...(g.gatilhos ?? []).flatMap((x) => [x.pista, x.resposta]), ...g.pontos_banca, ...g.pegadinhas, ...g.resumo,
    ...(g.questoes ?? []).flatMap((q) => [q.enunciado, ...q.alternativas, q.comentario]), ...g.perguntas.flatMap((q) => [q.pergunta, q.resposta]),
  ].join('\n');
  return { guide: { ...g, legislacao }, unverified: [...unverifiedLawRefs(text, provided, subject, extra), ...unverifiedPrecedents(text, juris)], droppedRefs: g.legislacao.length - legislacao.length };
}

// Chave de reaproveitamento: mesmo tema, mesmas fontes, mesma profundidade e versão do prompt.
// O título da sessão entra porque um tópico do edital pode cobrir várias sessões com temas diferentes. Como a IA
// escreve títulos diferentes a cada cronograma, o reaproveitamento entre planos fica com pickSimilarGuide.
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const topicKeys = (topics: string[]) => [...new Set(topics.map(norm).filter(Boolean))].sort();
// Palavras do título que indicam o tema, sem artigos entre parênteses.
export const titleKeys = (title: string) => [...new Set(norm(title.replace(/\([^)]*\)/g, ' ')).split(' ').filter((w) => w.length > 3))].sort();
// Fontes da apostila (artigos e, no nível superior, jurisprudência): também decidem o reaproveitamento entre sessões,
// então uma apostila com jurisprudência não serve a quem não a tem, e vice-versa.
export const lawKeys = (law: GuideSource[], juris: GuideSource[] = []) => [...new Set([...law, ...juris].map((l) => l.ref))].sort();

// Tema que depende do cargo (atribuições, rotina, funções): a apostila é do cargo e não serve para outro, mesmo com o mesmo tema.
// "Atribuições" de instituição ou autoridade (do STF, do Presidente, do Ministério Público) e "da função jurisdicional" são
// conteúdo comum: antes contavam como tema do cargo, e os vídeos exigiam o nome do cargo no título (só vinham vídeos
// genéricos sobre o cargo).
const ROLE_INST = 'stf|stj|tst|tse|stm|tcu|tce|cnj|cnmp|agu|cvm|supremo|superior|tribunal|tribunais|congresso|senado|camara|presidente|vice|ministerio|ministro|conselho|poder|poderes|uniao|estados?|municipios?|distrito|defensoria|advocacia|procuradoria|policia|juiz|juizes|magistrad[a-z]*|delegad[a-z]*|orgaos?|entes?|agencias?|autoridades?|banco|comissao|comissoes|mesa|governador|prefeito|justica|forcas';
const ROLE_LINK = 'd[oa]s?|e|a[os]?|conferidas?|constitucionais|institucionais|legais|privativas?|exclusivas?|competencias?|responsabilidades';
const ROLE_TOPIC = new RegExp(String.raw`\b(?:do|ao|d?esse|d?este|seu) cargo\b|rotina funcional|\batribuic(?:ao|oes)\b(?!(?: (?:${ROLE_LINK}))+ (?:${ROLE_INST})\b)`);
export const roleSpecific = (p: { title?: string; topics: string[] }) => ROLE_TOPIC.test(norm([p.title ?? '', ...p.topics].join(' ')));

// Jurisprudência só entra na chave quando há (apostila de nível superior): as chaves das demais não mudam.
export function guideCacheKey(p: { depth: GuideDepth; subject: string; title?: string; topics: string[]; law: GuideSource[]; juris?: GuideSource[]; fontes?: GuideSource[]; banca: string; cargo?: string }) {
  const s = JSON.stringify([guideVersion(p.depth), p.depth, norm(p.banca), norm(p.subject), titleKeys(p.title ?? ''), topicKeys(p.topics), p.law.map((l) => l.ref + '|' + l.text.length).sort(),
    ...(roleSpecific(p) ? [norm(p.cargo ?? '')] : []), ...(p.juris?.length ? [p.juris.map((j) => j.ref).sort()] : []), ...(p.fontes?.length ? [{ fontes: p.fontes.map((f) => f.ref).sort() }] : [])]);
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
