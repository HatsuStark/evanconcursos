// Aprender por Questões: o que a IA gera (roteiro, perguntas, conferência, correção de resposta escrita e perguntas de
// revisão) e as verificações feitas antes de mostrar qualquer pergunta. O motor da aula fica em shared/domain/tutor.ts.
import { z } from 'zod';
import { unverifiedLawRefs, type ProvidedArticle } from './guide.ts';
import type { LawEntry } from '../legal/registry.ts';
import { LETTERS, matchesText, type TutorConcept, type TutorLesson, type TutorQuestion } from '../domain/tutor.ts';

// v2: explicação autossuficiente (cartão do modo iniciante), construção com andaime, regras de distratores e de
// certo/errado, alternativas embaralhadas no servidor.
// v3: distratores para responder lacuna e resposta curta sem digitar.
export const TUTOR_PROMPT_VERSION = 'tutor-v3';
export const TUTOR_REVIEW_VERSION = 'tutor-review-v3';
export const TUTOR_GRADE_VERSION = 'tutor-grade-v1';

export interface TutorSource { ref: string; text: string }
export interface TutorInput { banca: string; cargo: string; subject: string; title: string; topics: string[]; law: TutorSource[]; format: string }

// ---------- Schemas ----------

const Conceito = z.object({
  id: z.string().describe('c1, c2, c3… na ordem de ensino.'),
  nome: z.string().describe('Nome curto do conceito (até 8 palavras).'),
  essencial: z.string().describe('A ideia central em 1 ou 2 frases, como o candidato deve lembrar.'),
  explicacao: z.string().describe('Explicação didática autossuficiente (3 a 5 frases): a regra, o porquê e o detalhe que a prova cobra. Quem nunca viu o tema precisa entender só com ela.'),
  outro_jeito: z.string().describe('Exemplo concreto do conceito aplicado (um caso com personagens, órgãos ou situações reais) ou analogia do cotidiano, em até 3 frases.'),
  base: z.string().describe('Dispositivo legal fornecido que fundamenta o conceito, exatamente como no colchete (ex.: "CF, art. 37"); vazio se não houver.'),
});
export const TutorOutline = z.object({
  titulo: z.string(),
  conceitos: z.array(Conceito).describe('4 a 7 conceitos, do fundamento às diferenças, exceções e aplicações.'),
});
export type TutorOutline = z.infer<typeof TutorOutline>;

const Questao = z.object({
  id: z.string(),
  etapa: z.enum(['diagnostico', 'construcao', 'reforco', 'aplicacao', 'fixacao', 'final', 'revisao']),
  conceito: z.string().describe('id do conceito cobrado.'),
  estilo: z.enum(['conceito', 'situacao', 'erro', 'comparacao', 'aplicacao']),
  formato: z.enum(['multipla', 'certo_errado', 'lacuna', 'curta', 'ordenacao']),
  enunciado: z.string(),
  alternativas: z.array(z.string()).describe('multipla: 4 ou 5 opções, sem letra no início; ordenacao: 3 a 6 itens NA ORDEM CORRETA; demais: vazio.'),
  gabarito: z.string().describe('multipla: letra (A, B…); certo_errado: "C" ou "E"; lacuna/curta: a resposta esperada, curta; ordenacao: vazio.'),
  aceitas: z.array(z.string()).describe('lacuna/curta: outras formas corretas de escrever a resposta (sinônimos, siglas); demais: vazio.'),
  dica: z.string().describe('Pista que faz pensar, sem entregar a resposta.'),
  explicacao: z.string().describe('Por que o gabarito está certo, em até 4 frases, citando a base quando houver.'),
  erros: z.array(z.string()).describe('multipla: para cada alternativa, na mesma ordem, por que está errada (vazio na correta); demais: vazio.'),
  distratores: z.array(z.string()).describe('lacuna/curta: 3 respostas ERRADAS plausíveis, do mesmo tipo e tamanho da correta (termos que o candidato confunde); demais: vazio.'),
});
export const TutorQuestions = z.object({ questoes: z.array(Questao) });
export type TutorQuestions = z.infer<typeof TutorQuestions>;

export const TutorVerdicts = z.object({
  avaliacoes: z.array(z.object({ id: z.string(), aprovada: z.boolean(), motivo: z.string() })),
});
export type TutorVerdicts = z.infer<typeof TutorVerdicts>;

export const TutorGrade = z.object({ correta: z.boolean(), comentario: z.string().describe('Até 2 frases: o que faltou ou o que acertou.') });
export type TutorGrade = z.infer<typeof TutorGrade>;

const js = (s: z.ZodType) => z.toJSONSchema(s, { target: 'draft-7' });
export const tutorOutlineJsonSchema = () => js(TutorOutline);
export const tutorQuestionsJsonSchema = () => js(TutorQuestions);
export const tutorVerdictsJsonSchema = () => js(TutorVerdicts);
export const tutorGradeJsonSchema = () => js(TutorGrade);

// ---------- Prompts ----------

const context = (p: TutorInput) => `Concurso: ${p.cargo || 'não informado'}${p.banca ? `, banca ${p.banca}` : ''}.
Matéria: ${p.subject}
Tema da sessão: ${p.title}
Item do edital (só contexto; pode citar assuntos de outras sessões): ${p.topics.join(' | ') || '—'}
${p.law.length ? `Trechos oficiais da lei (lei seca vigente, única fonte legal permitida):\n${p.law.map((l) => `[${l.ref}] ${l.text}`).join('\n\n')}` : 'Nenhum trecho de lei foi fornecido para este tema.'}`;

const SOURCE_RULES = (p: TutorInput) => `- Fique só no "Tema da sessão"; o que o item do edital trouxer de outros temas fica de fora.
- ${p.law.length ? 'Cite artigos SOMENTE dos trechos fornecidos, no formato do colchete, e siga o texto deles (é a versão vigente).' : 'Não cite números de artigos nem de leis.'}
- Não cite jurisprudência, súmulas, autores ou posições doutrinárias. Não invente leis, prazos, números ou exceções.
- Ponto controvertido ou que você não consegue fundamentar com segurança: deixe de fora.`;

export function tutorOutlinePrompt(p: TutorInput) {
  return `Você é professor especialista em concursos públicos brasileiros e vai ENSINAR o tema por meio de perguntas (aprendizagem ativa), para um candidato que talvez nunca tenha estudado o assunto.
${context(p)}
Primeiro, monte o roteiro pedagógico: os conceitos que o candidato precisa dominar para resolver as questões da prova, na ordem em que devem ser ensinados — fundamento, regras, diferenças importantes, exceções e aplicações práticas. Priorize o que a ${p.banca || 'banca'} mais cobra.
Regras:
- 4 a 7 conceitos, cada um ensinável em 2 ou 3 perguntas. Juntar ideias pequenas é melhor que fragmentar.
- Cada conceito pode depender só dos anteriores no roteiro (comece pelo que dá base aos outros).
- explicacao é lida antes da primeira pergunta por quem nunca estudou o tema: defina os termos técnicos na primeira vez que aparecem e diga por que a regra existe. Linguagem simples, direta e motivadora, sem enrolação.
- outro_jeito traz um exemplo concreto aplicado (de preferência um caso parecido com os da prova) ou uma analogia; não repita a explicação com outras palavras.
- Inclua, quando houver, a diferença ou exceção que a banca mais usa como pegadinha.
${SOURCE_RULES(p)}
- Sem markdown.`.replace(/\n{2,}/g, '\n');
}

const FORMAT_RULES = (p: TutorInput) => `Formatos (escolha o melhor para cada ponto; não precisa usar todos, mas varie):
- multipla: 4 ou 5 alternativas plausíveis, uma só correta, com "erros" explicando cada errada.
- certo_errado: afirmação para julgar (ótimo para leis, exceções e conceitos)${/certo/i.test(p.format) ? '; é o formato da banca, use bastante' : ''}.
- lacuna: frase com "___" no lugar da palavra-chave; a resposta é uma palavra ou expressão curta e única. O candidato completa escolhendo entre a resposta e os 3 distratores.
- curta: pergunta direta cuja resposta é um termo ou expressão (até 8 palavras); o candidato escolhe entre a resposta e os 3 distratores.
- distratores (lacuna e curta): do mesmo tipo e tamanho da resposta (outro princípio, outro prazo, outro órgão, o instituto vizinho), cada um claramente errado para quem domina o conceito, nunca sinônimo da resposta.
- ordenacao: etapas, procedimentos ou sequências; itens na ordem correta (a tela embaralha).
Estilos: conceito, situacao (caso prático), erro (achar o erro numa afirmação que parece certa), comparacao (institutos parecidos), aplicacao (aplicar a regra).
Distratores e afirmações:
- Em multipla, cada alternativa errada representa uma confusão real de quem estuda o tema (instituto vizinho, exceção trocada, prazo ou competência trocados, regra geral aplicada à exceção), nunca algo absurdo. Alternativas com tamanho e estrutura parecidos; a correta não pode ser a mais longa ou a mais detalhada. Nada de "todas as anteriores" ou "nenhuma das anteriores".
- Em certo_errado, equilibre: cerca de metade das afirmações erradas. A afirmação errada erra em UM ponto específico e relevante (termo, exceção, prazo, sujeito), nunca por detalhe de português; evite "sempre", "nunca", "apenas" quando denunciarem a resposta.
- Situações-problema com personagens, órgãos e fatos concretos, que exijam aplicar a regra (não basta reconhecer a definição).`;

const QUESTION_RULES = (p: TutorInput) => `Regras de qualidade:
- Uma única resposta correta, sem ambiguidade; o enunciado não entrega a resposta.
- Perguntas sobre o mesmo conceito precisam ter formulações realmente diferentes (outro ângulo, outro caso), nunca a mesma frase trocando palavras.
- dica aponta a regra ou o raciocínio a usar (ex.: "pense em quem tem a competência"), sem sinônimo nem pedaço da resposta.
- explicacao começa pelo porquê do gabarito e termina com a confusão que a pergunta testou, em até 4 frases.
- lacuna e curta: aceitas traz as variações corretas (sinônimo, sigla, com ou sem artigo).
${SOURCE_RULES(p)}
- Sem markdown e sem letras ("A)") no início das alternativas.`;

const outlineText = (o: { conceitos: TutorConcept[] }) => o.conceitos.map((c) => `${c.id} — ${c.nome}: ${c.essencial}${c.base ? ` [${c.base}]` : ''}`).join('\n');

// Perguntas da aula em duas partes, pedidas em paralelo: a primeira (diagnóstico e construção) já permite começar.
export type TutorPart = 'inicio' | 'pratica';
export function tutorQuestionsPrompt(p: TutorInput, outline: TutorOutline, part: TutorPart) {
  const n = outline.conceitos.length;
  const plan = part === 'inicio'
    ? `Monte agora SÓ estas perguntas (ids d1…, k1…, r1…):
- diagnostico: 3 perguntas (ids d1, d2, d3) sobre os fundamentos dos conceitos mais básicos, para descobrir o que o candidato já sabe. Fechadas (certo_errado ou multipla).
- construcao: 1 pergunta por conceito (${n} no total, ids k1…), na ordem do roteiro, introdutória e progressiva. Com andaime: o enunciado traz um contexto curto (um caso ou uma premissa) que permite raciocinar até a resposta a partir da explicação do conceito e dos anteriores; cobre a ideia central, não detalhes. Prefira certo_errado ou multipla.
- reforco: 1 pergunta por conceito (${n} no total, ids r1…), para quem errou a de construção: outro ângulo (outro caso ou o inverso da regra), um pouco mais simples, nunca a mesma pergunta reescrita.`
    : `Monte agora SÓ estas perguntas (ids a1…, f1…, z1…):
- aplicacao: 3 ou 4 perguntas (ids a1…) que exijam interpretar, comparar conceitos, aplicar regras e analisar situações práticas, no estilo da ${p.banca || 'banca'}.
- fixacao: 1 pergunta por conceito (${n} no total, ids f1…), com formulação diferente das anteriores, para recuperar da memória sem pista: pelo menos metade em curta ou lacuna; o resto em certo_errado.
- final: 4 a 6 perguntas (ids z1…) cobrindo os conceitos mais importantes, sem pistas, no nível e no estilo da prova da ${p.banca || 'banca'}, com pelo menos uma situação-problema e uma que compare conceitos.`;
  return `Você é professor especialista em concursos públicos brasileiros e está ensinando o tema por meio de perguntas.
${context(p)}
Roteiro da aula (conceitos na ordem de ensino):
${outlineText(outline)}
${plan}
${FORMAT_RULES(p)}
${QUESTION_RULES(p)}`.replace(/\n{2,}/g, '\n');
}

const questionText = (q: TutorQuestion) => [
  `[${q.id}] (${q.formato}) ${q.enunciado}`,
  ...(q.formato === 'multipla' ? q.alternativas.map((a, i) => `${LETTERS[i]}) ${a}`) : q.formato === 'ordenacao' ? [`Ordem correta: ${q.alternativas.join(' → ')}`] : []),
  q.formato === 'ordenacao' ? '' : `Gabarito: ${q.gabarito}${q.aceitas.length ? ` (também: ${q.aceitas.join('; ')})` : ''}`,
  ...(q.distratores?.length ? [`Opções erradas: ${q.distratores.join('; ')}`] : []),
  `Explicação: ${q.explicacao}`,
].filter(Boolean).join('\n');

// Segunda leitura, como revisor de banca: reprova o que não deveria chegar ao estudante.
export function tutorVerifyPrompt(p: TutorInput, questions: TutorQuestion[]) {
  return `Você é revisor técnico de uma banca de concursos. Confira cada pergunta didática abaixo antes de ela chegar ao candidato.
${context(p)}
Reprove (aprovada: false) a pergunta que tiver QUALQUER destes problemas:
- gabarito errado, discutível ou desatualizado; mais de uma alternativa defensável; lacuna ou resposta curta com outra resposta correta que não esteja entre as aceitas;
- opção errada (distrator) que também esteja correta ou seja sinônimo da resposta;
- afirmação de certo/errado que dependa de interpretação, ou cujo erro seja só de português; dica que entregue a resposta;
- contradição com os trechos de lei fornecidos, ou cita artigo, lei, súmula ou jurisprudência que não está nos trechos;
- enunciado ambíguo, confuso ou que entrega a resposta; explicação que não sustenta o gabarito;
- fora do tema da sessão.
Aprove o que estiver correto, mesmo que simples. motivo: uma frase (vazio se aprovada).
Perguntas:
${questions.map(questionText).join('\n\n')}`.replace(/\n{2,}/g, '\n');
}

export function tutorGradePrompt(p: { subject: string; enunciado: string; gabarito: string; aceitas: string[]; explicacao: string; resposta: string }) {
  return `Você corrige uma resposta escrita de um candidato de concurso em uma atividade de estudo.
Matéria: ${p.subject}
Pergunta: ${p.enunciado}
Resposta esperada: ${p.gabarito}${p.aceitas.length ? ` (também aceitas: ${p.aceitas.join('; ')})` : ''}
Explicação: ${p.explicacao}
Resposta do candidato: ${p.resposta.slice(0, 600)}
Considere correta se tiver o mesmo sentido da resposta esperada, mesmo com outras palavras ou pequenos erros de grafia. Errada se faltar a ideia principal, se trocar o conceito ou se for vaga demais. Sem markdown.`;
}

// Revisão espaçada: uma pergunta nova por conceito vencido, diferente das que o estudante já viu.
export interface ReviewConcept { id: string; nome: string; essencial: string; base: string; subject: string; banca: string; recent: string[]; level: string }
export function tutorReviewPrompt(concepts: ReviewConcept[], law: TutorSource[]) {
  return `Você é professor especialista em concursos públicos brasileiros. O candidato estudou os conceitos abaixo e agora faz a revisão espaçada: uma pergunta NOVA por conceito, para ele recuperar da memória.
${law.length ? `Trechos oficiais da lei (lei seca vigente, única fonte legal permitida):\n${law.map((l) => `[${l.ref}] ${l.text}`).join('\n\n')}` : ''}
Conceitos (id — matéria — nome: ideia central [base]; perguntas já vistas, para NÃO repetir):
${concepts.map((c) => `${c.id} — ${c.subject}${c.banca ? ` (banca ${c.banca})` : ''} — ${c.nome}: ${c.essencial}${c.base ? ` [${c.base}]` : ''}${c.level === 'atencao' ? ' (o candidato tem dificuldade aqui: cobre o ponto central)' : ''}${c.recent.length ? `\n   já vistas: ${c.recent.slice(-5).map((r) => `"${r.slice(0, 160)}"`).join(' | ')}` : ''}`).join('\n')}
Monte exatamente uma pergunta por conceito (id da pergunta = "v" + número; conceito = id do conceito; etapa "revisao"), com formulação e ângulo diferentes das já vistas (outro caso, o inverso da regra, a exceção). Varie os formatos entre os conceitos e prefira os que exigem lembrar (curta, lacuna, certo_errado). Distratores de multipla representam confusões reais; afirmação errada de certo_errado erra em um ponto só e relevante.
Formatos: multipla (4 ou 5 alternativas, "erros" por alternativa), certo_errado (gabarito C ou E), lacuna (frase com "___"), curta (resposta de até 8 palavras), ordenacao (itens na ordem correta). Lacuna e curta trazem 3 distratores (respostas erradas plausíveis, do mesmo tipo e tamanho).
Regras: uma única resposta correta; a pergunta não entrega a resposta; dica faz pensar; explicacao em até 4 frases. ${law.length ? 'Cite artigos SOMENTE dos trechos fornecidos.' : 'Não cite números de artigos.'} Não cite jurisprudência nem doutrina; não invente leis, prazos ou números. Sem markdown.`.replace(/\n{2,}/g, '\n');
}

// ---------- Verificações sem IA ----------

const words = (s: string) => new Set(s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
const similarity = (a: string, b: string) => {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
};
const NEAR_DUPLICATE = 0.75;

// Estrutura da pergunta: formato coerente com alternativas e gabarito, conceito existente, texto preenchido.
export function structureProblem(q: TutorQuestion, conceptIds: Set<string>): string | null {
  if (!q.enunciado.trim() || !q.explicacao.trim()) return 'sem enunciado ou explicação';
  if (!conceptIds.has(q.conceito)) return 'conceito desconhecido';
  const alts = q.alternativas.map((a) => a.trim());
  if (q.formato === 'multipla') {
    const i = LETTERS.indexOf(q.gabarito.trim().toUpperCase());
    if (alts.length < 3 || alts.length > 6 || i < 0 || i >= alts.length) return 'alternativas ou gabarito inválidos';
    if (new Set(alts.map((a) => a.toLowerCase())).size !== alts.length || alts.some((a) => !a)) return 'alternativas repetidas';
  } else if (q.formato === 'certo_errado') {
    if (!/^[CE]$/i.test(q.gabarito.trim())) return 'gabarito de certo/errado inválido';
  } else if (q.formato === 'ordenacao') {
    if (alts.length < 3 || alts.length > 7 || new Set(alts).size !== alts.length) return 'itens de ordenação inválidos';
  } else {
    if (!q.gabarito.trim() || q.gabarito.length > 120) return 'resposta esperada inválida';
    if (q.formato === 'lacuna' && !/_{3,}/.test(q.enunciado)) return 'lacuna sem espaço';
  }
  return null;
}

// Alternativas em ordem embaralhada (sempre a mesma para a mesma pergunta): a IA tende a pôr o gabarito em B ou C.
// "erros" acompanha cada alternativa.
export function shuffleOptions(q: Pick<TutorQuestion, 'id' | 'enunciado' | 'alternativas' | 'gabarito' | 'erros'>) {
  let h = 2166136261;
  for (const ch of q.enunciado + q.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const idx = q.alternativas.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  const right = LETTERS.indexOf(q.gabarito);
  return { alternativas: idx.map((i) => q.alternativas[i]!), erros: idx.map((i) => q.erros[i] ?? ''), gabarito: LETTERS[idx.indexOf(right)]! };
}

// Prepara as perguntas para a tela: corrige o que é só forma (letra no início das alternativas, gabarito em minúscula,
// "erros" no tamanho certo) e descarta as que têm problema de estrutura, citam artigo fora das fontes ou repetem outra.
export function cleanQuestions(questions: TutorQuestion[], o: { concepts: TutorConcept[]; provided: ProvidedArticle[]; subject: string; extra?: LawEntry[]; existing?: TutorQuestion[]; idPrefix?: string; shuffle?: boolean }) {
  const ids = new Set(o.concepts.map((c) => c.id));
  const kept: TutorQuestion[] = [], dropped: { id: string; motivo: string }[] = [];
  const seen = [...(o.existing ?? [])];
  for (const raw of questions) {
    const q: TutorQuestion = {
      ...raw,
      id: `${o.idPrefix ?? ''}${raw.id}`.slice(0, 40),
      alternativas: raw.alternativas.map((a) => a.replace(/^\s*[A-Fa-f][).]\s+/, '').trim()),
      gabarito: raw.formato === 'multipla' || raw.formato === 'certo_errado' ? raw.gabarito.trim().toUpperCase().charAt(0) : raw.formato === 'ordenacao' ? '' : raw.gabarito.trim(),
      aceitas: raw.formato === 'lacuna' || raw.formato === 'curta' ? raw.aceitas.filter((a) => a.trim()) : [],
      distratores: raw.formato === 'lacuna' || raw.formato === 'curta' ? (raw.distratores ?? []).map((d) => d.trim()).filter((d) => d && !matchesText(d, raw)).slice(0, 4) : [],
      erros: raw.formato === 'multipla' ? raw.alternativas.map((_, i) => raw.erros[i] ?? '') : [],
    };
    const problem = structureProblem(q, ids);
    if (problem) { dropped.push({ id: q.id, motivo: problem }); continue; }
    if (q.formato === 'multipla' && o.shuffle !== false) Object.assign(q, shuffleOptions(q));
    const text = [q.enunciado, ...q.alternativas, q.gabarito, q.dica, q.explicacao, ...q.erros].join('\n');
    const bad = unverifiedLawRefs(text, o.provided, o.subject, o.extra ?? []);
    if (bad.length) { dropped.push({ id: q.id, motivo: `cita ${bad.slice(0, 2).join(', ')} fora das fontes` }); continue; }
    if (seen.some((s) => s.id === q.id || similarity(s.enunciado, q.enunciado) >= NEAR_DUPLICATE)) { dropped.push({ id: q.id, motivo: 'repetida' }); continue; }
    seen.push(q);
    kept.push(q);
  }
  return { kept, dropped };
}

// Conceito citando artigo fora das fontes perde só a base (a explicação continua útil).
export function cleanConcepts(concepts: TutorConcept[], o: { provided: ProvidedArticle[]; subject: string; extra?: LawEntry[] }): TutorConcept[] {
  const seen = new Set<string>();
  return concepts.filter((c) => c.id && c.nome.trim() && !seen.has(c.id) && seen.add(c.id)).map((c) => {
    const text = [c.essencial, c.explicacao, c.outro_jeito, c.base].join('\n');
    return unverifiedLawRefs(text, o.provided, o.subject, o.extra ?? []).length ? { ...c, base: '' } : c;
  });
}

// Pergunta reprovada pelo revisor sai; avaliação ausente conta como aprovada (o revisor pode pular uma).
export const applyVerdicts = (qs: TutorQuestion[], v: TutorVerdicts | null) => {
  if (!v) return qs;
  const rejected = new Set(v.avaliacoes.filter((a) => !a.aprovada).map((a) => a.id));
  return qs.filter((q) => !rejected.has(q.id));
};

// Aula mínima: sem diagnóstico ou sem construção suficiente, a aula não ensina; melhor falhar e tentar de novo.
export function lessonUsable(l: Pick<TutorLesson, 'conceitos' | 'questoes'>) {
  const k = l.questoes.filter((q) => q.etapa === 'construcao').length;
  return l.conceitos.length >= 2 && k >= Math.min(2, l.conceitos.length);
}

// Chave do cache: mesmo tema, mesmas fontes, mesma banca e versão do prompt servem a qualquer estudante.
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function tutorCacheKey(p: Pick<TutorInput, 'banca' | 'subject' | 'title' | 'topics' | 'law'>) {
  const s = JSON.stringify([TUTOR_PROMPT_VERSION, norm(p.banca), norm(p.subject), norm(p.title.replace(/\([^)]*\)/g, ' ')), [...new Set(p.topics.map(norm))].sort(), p.law.map((l) => l.ref + '|' + l.text.length).sort()]);
  let h1 = 0x811c9dc5, h2 = 0;
  for (let i = 0; i < s.length; i++) { h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0; h2 = (h2 * 31 + s.charCodeAt(i)) >>> 0; }
  return `t${h1.toString(16)}${h2.toString(16)}`;
}
