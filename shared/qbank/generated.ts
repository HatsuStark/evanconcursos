// Questões inéditas da IA para a sessão: o plano B quando o banco de questões não tem mais questão no tema (a triagem de
// relevância descarta as de outro tema). Seguem o formato e o estilo da banca, cobram só o tema da sessão e se apoiam
// nos artigos oficiais da lei seca. Ficam no mesmo cache das questões reais (qid "ia-…"), então correção, caderno de
// erros, explicação e comentários funcionam igual, e são reaproveitadas entre estudantes com o mesmo tema.
import { z } from 'zod';
import { MARK_RULE, marksToHtml, missingMark } from '../ai/marks.ts';
import { normalizeText } from '../ai/notice.ts';
import { roleContext } from '../ai/plan.ts';

// qgen-v2: média a difícil de verdade. A v1 saía genérica ("assinale a correta" sobre o tema inteiro, só caput, distratores
// absurdos como "a arbitragem é vedada"). Agora o prompt traz questões reais da banca no tema como modelo de estilo e nível,
// pede caso concreto, parágrafos, incisos e exceções, e distrator que troca um único detalhe do texto da lei.
// Questões de versões anteriores não são reaproveitadas.
// qgen-v3: receita de dificuldade por tipo de tema (lei, prática, língua, cálculo), apostila da sessão como fonte e
// alternativas embaralhadas no código.
export const GENERATED_PROMPT_VERSION = 'qgen-v3';
export const GENERATED_BANCA = 'Inédita (IA)';
export const GENERATED_MAX = 5;

export const GeneratedQuestions = z.object({
  questoes: z.array(z.object({
    enunciado: z.string().describe('Trecho chamado de "destacado" no comando vai entre **duplo asterisco**.'),
    alternativas: z.array(z.string()).describe('5 alternativas sem a letra; vazio em certo ou errado.'),
    gabarito: z.string().describe('Letra correta (A a E) ou C/E em certo ou errado.'),
    fundamento: z.string().describe('O que decide a resposta (dispositivo de lei, regra, procedimento ou a conta) e o detalhe que os distratores trocaram, em até 30 palavras.'),
  })),
});
export const generatedJsonSchema = () => z.toJSONSchema(GeneratedQuestions, { target: 'draft-7' });

export interface GenSource { ref: string; text: string }
// Questão real da banca no tema, usada só como modelo de estilo e dificuldade.
export interface GenExample { enunciado: string; alternativas: string[]; gabarito: string; banca: string }
const plain = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
export const GENERATED_EXAMPLES = 3;
// Chave do tema: a mesma sessão (matéria + título) reaproveita as questões já criadas, de qualquer estudante.
// `cargo`: em conhecimentos específicos e em tema sobre o cargo, a questão depende das atribuições dele (Agente Escolar ×
// Agente de Segurança Escolar no mesmo tema "O espaço escolar"), então o cargo entra na chave.
export const generatedTheme = (materia: string, title: string, cargo = '') => normalizeText(`${materia} | ${title}${cargo ? ` | ${cargo}` : ''}`);

// Tipo do tema, que muda o que é "difícil": em lei, o detalhe do dispositivo; em tema prático (limpeza, EPIs, primeiros
// socorros, rotina escolar), a conduta certa entre condutas quase certas; em língua, a regra aplicada a um trecho; em
// cálculo, o resultado certo entre os resultados de erros típicos. A v2 aplicava a receita de lei a tudo e forçava
// "incisos" e "caput" em temas sem lei.
export type ThemeKind = 'lei' | 'pratica' | 'lingua' | 'calculo';
export function themeKind(p: { subject: string; title: string; law: GenSource[] }): ThemeKind {
  const s = normalizeText(`${p.subject} ${p.title}`);
  // Tema jurídico sem trecho de lei na base (lei municipal, estatuto local) continua sendo de lei.
  if (p.law.length || /\b(direito|lei|leis|legislacao|estatuto|codigo|constituicao|regimento|decreto|normas? da corregedoria)\b/.test(s)) return 'lei';
  if (/\b(matematica|raciocinio|estatistica|financeira|calculo|contabilidade|porcentagem|juros|fracoes|equac)/.test(s)) return 'calculo';
  if (/\b(portugues|lingua|gramatica|redacao|interpretacao de texto|ingles|espanhol|ortografia|concordancia|crase)/.test(s)) return 'lingua';
  return 'pratica';
}

const RECIPES: Record<ThemeKind, string> = {
  lei: `- Pelo menos metade das questões é um caso concreto (personagens, fatos e um pedido ao candidato) que exige aplicar a regra, não só reconhecê-la.
- Cobre parágrafos, incisos, exceções, ressalvas ("salvo", "exceto", "independentemente de") e a combinação de dois dispositivos do tema; evite questão que se resolve só com o caput mais conhecido.
- Cada distrator é quase verdadeiro: parte do texto da lei e troca um único detalhe (prazo, sujeito, exceção, consequência, "pode" × "deve", absoluta × relativa, de ofício × a requerimento). O erro tem de exigir atenção para ser visto.
- Proibido distrator absurdo ou que contradiz o princípio mais básico do tema (ex.: "a arbitragem é vedada"), e proibido marcar o erro com "exclusivamente", "jamais", "sempre", "vedado" quando só essas palavras tornam a alternativa falsa.
- Comando específico, como na prova (ex.: "Nessa situação, de acordo com o CPC, …", "Assinale a alternativa que indica corretamente o juízo competente").`,
  pratica: `- Pelo menos metade das questões é uma situação do dia a dia do cargo (o que aconteceu, onde, com quem) que pede a conduta, o procedimento, o material ou a ordem certa.
- Cobre o porquê e a ordem dos passos, as exceções e os cuidados que o iniciante esquece; evite pergunta de definição que se resolve pelo bom senso.
- Cada distrator é uma conduta plausível que um servidor desatento faria: certa em outra situação, na ordem errada, incompleta ou com um detalhe trocado. Nada de conduta absurda, grosseira ou antiética que ninguém escolheria.
- Não invente números, normas ou siglas: use os da apostila ou regras que você tem certeza de que são práticas reconhecidas.`,
  lingua: `- Cada questão traz um trecho curto e original (2 a 4 frases, escrito por você) e pede a análise de uma palavra, construção ou parte dele.
- Cobre a regra aplicada (classe da palavra no contexto, concordância, regência, crase, pontuação, sentido) e as exceções que a banca explora.
- Cada distrator é um erro típico de quem decorou a regra pela metade: a análise que vale noutro contexto, a regra geral onde cabe a exceção, a classe de palavra parecida.
- A correta precisa ser a única defensável pela gramática normativa; evite ambiguidade de estilo ou de gosto.`,
  calculo: `- Cada questão é um problema com números, de preferência numa situação concreta, que exige pelo menos dois passos de cálculo.
- Faça a conta duas vezes antes de fixar o gabarito; use números que dão resultado exato.
- Cada distrator é o resultado de um erro típico: esquecer uma conversão de unidade, inverter a razão, somar em vez de multiplicar, parar no passo intermediário, arredondar cedo.
- No fundamento, escreva a conta que leva à resposta.`,
};

// Texto da apostila da sessão que serve de base às questões: seções, quadros, o que memorizar e as pegadinhas.
export function guideDigest(g: unknown, max = 6000): string {
  const c = (g ?? {}) as { secoes?: { titulo?: string; texto?: string; exemplos?: string[] }[]; quadros?: { titulo?: string; colunas?: string[]; linhas?: string[][] }[]; memorizar?: string[]; pegadinhas?: string[] };
  const parts = [
    ...(c.secoes ?? []).map((x) => `${x.titulo ?? ''}: ${x.texto ?? ''}${x.exemplos?.length ? ` Exemplos: ${x.exemplos.join(' | ')}` : ''}`),
    ...(c.quadros ?? []).map((q) => `${q.titulo ?? ''}: ${[q.colunas ?? [], ...(q.linhas ?? [])].map((l) => l.join(' / ')).join('; ')}`),
    c.memorizar?.length ? `Memorizar: ${c.memorizar.join('; ')}` : '',
    c.pegadinhas?.length ? `Pegadinhas: ${c.pegadinhas.join('; ')}` : '',
  ].filter(Boolean);
  return parts.map(plain).join('\n').slice(0, max);
}

// duties/otherRoles: atribuições do cargo no edital e os outros cargos dele. Sem elas, a IA deduzia pelo nome e, no edital
// de Suzano, pôs o Agente Escolar na recepção e no controle de acesso, que são do Agente de Segurança Escolar.
// guide: texto da apostila da sessão (guideDigest), a base do conteúdo quando há; a questão não a contradiz.
export function generatedPrompt(p: { banca: string; cargo: string; subject: string; title: string; keyword: string; law: GenSource[]; format: string; n: number; avoid: string[]; examples?: GenExample[]; duties?: string; otherRoles?: string[]; guide?: string }) {
  const ce = /certo/i.test(p.format);
  const kind = themeKind(p);
  const examples = (p.examples ?? []).slice(0, GENERATED_EXAMPLES);
  return `Você é professor especialista em concursos e elabora questões inéditas no estilo da banca ${p.banca || 'do concurso'}${p.cargo ? `, para o cargo ${p.cargo}` : ''}.
${roleContext(p.cargo, p.duties, p.otherRoles)}
Disciplina: ${p.subject}
Tema da sessão (cobre SOMENTE este tema): ${p.title}
Palavra-chave: ${p.keyword || '—'}
${p.law.length ? `Trechos oficiais da lei (única fonte legal permitida):\n${p.law.map((l) => `[${l.ref}] ${l.text}`).join('\n\n')}` : 'Nenhum trecho de lei foi fornecido: cobre só regras e conceitos que você tem certeza de que estão em vigor, sem citar número de artigo.'}
${p.guide?.trim() ? `Apostila que o estudante leu nesta sessão (base do conteúdo; nenhuma questão pode contradizê-la, e o que não estiver nela só entra se você tiver certeza):\n${p.guide.trim()}` : ''}
${examples.length ? `Questões reais de prova neste tema (modelo de estilo e de dificuldade; não copie o conteúdo):\n${examples.map((e, i) => `Exemplo ${i + 1} (${e.banca || 'banca'}):\n${plain(e.enunciado).slice(0, 900)}${e.alternativas.length ? `\n${e.alternativas.map((a, j) => `${String.fromCharCode(65 + j)}) ${plain(a).slice(0, 300)}`).join('\n')}` : ''}\nGabarito: ${e.gabarito}`).join('\n\n')}` : ''}
${p.avoid.length ? `Questões já criadas para este tema (não repita o que elas cobram nem a forma):\n${p.avoid.map((e) => `- ${e.slice(0, 200)}`).join('\n')}` : ''}
Regras:
- Crie ${p.n} questões ${ce ? 'de certo ou errado (alternativas vazias; gabarito "C" ou "E")' : 'de múltipla escolha com 5 alternativas (gabarito A a E)'}, de dificuldade média a difícil: quem só leu o tema por cima erra.
- Cada questão cobra o tema da sessão: nada de outros assuntos da matéria, mesmo parecidos.
- ${MARK_RULE}
- Caso concreto com servidor do cargo${p.cargo ? ` (${p.cargo})` : ''}: só situações e tarefas que as atribuições dele incluem. Nunca o ponha fazendo o trabalho de outro cargo do edital (ex.: quem cuida da limpeza e conservação não faz controle de acesso nem vigilância).
- Fundamente nas fontes fornecidas: não invente prazos, números ou regras. Não cite jurisprudência, súmulas ou doutrina.
- Exatamente uma alternativa correta${ce ? '' : '; as alternativas não se referem umas às outras ("todas as anteriores", "A e B") e podem ser lidas em qualquer ordem'}.
Como chegar à dificuldade média a difícil:
${RECIPES[kind]}
- Alternativas de tamanho parecido; a correta não pode ser a mais longa nem a mais detalhada.
- Varie o que cada questão cobra.
- Sem markdown e sem letras antes das alternativas.`;
}

// A IA tende a pôr a correta nas mesmas letras e a deixá-la mais longa e detalhada que as outras, o que entrega a
// resposta. As alternativas são embaralhadas no código, com as letras corretas espalhadas pelo lote, e sai a questão em
// que a correta é bem mais longa que as outras (40% acima da média e 15 caracteres acima da maior).
export const LONG_CORRECT_RATIO = 1.4;
const crossRef = /\b(todas|nenhuma) (as|das) (anteriores|alternativas|acima)|\balternativas? [a-e]\b|\b[a-e] e [a-e]\b/i;
type GenQ = z.infer<typeof GeneratedQuestions>['questoes'][number];
export function arrangeBatch(qs: GenQ[], rand: () => number = Math.random): GenQ[] {
  const letters = ['A', 'B', 'C', 'D', 'E'];
  for (let i = letters.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [letters[i], letters[j]] = [letters[j]!, letters[i]!]; }
  let slot = 0;
  return qs.flatMap((q) => {
    const alts = q.alternativas.map((a) => a.replace(/^\s*[A-Ea-e]\s*[).:-]\s*/, '').trim());
    const right = q.gabarito.trim().slice(0, 1).toUpperCase().charCodeAt(0) - 65;
    if (alts.length !== 5 || right < 0 || right > 4) return [q]; // certo ou errado, ou fora do formato (toPublic decide)
    const others = alts.filter((_, i) => i !== right);
    const avg = others.reduce((a, t) => a + t.length, 0) / others.length;
    if (alts[right]!.length > LONG_CORRECT_RATIO * avg && alts[right]!.length - Math.max(...others.map((t) => t.length)) > 15) return [];
    if (alts.some((t) => crossRef.test(t))) return [{ ...q, alternativas: alts }];
    const letter = letters[slot++ % 5]!;
    const rest = others.map((t) => ({ t, k: rand() })).sort((a, b) => a.k - b.k).map((x) => x.t);
    rest.splice(letter.charCodeAt(0) - 65, 0, alts[right]!);
    return [{ ...q, alternativas: rest, gabarito: letter }];
  });
}

// Questão no formato público das questões reais, mais a marca do tema para reaproveitar.
export function toPublic(q: z.infer<typeof GeneratedQuestions>['questoes'][number], p: { qid: string; format: string; materia: string; assunto: string; theme: string; year: number; sources?: number }) {
  const ce = /certo/i.test(p.format) || !q.alternativas.length;
  const alternativas = ce ? [{ letra: 'C', texto: 'Certo', imagens: [] as string[] }, { letra: 'E', texto: 'Errado', imagens: [] as string[] }]
    : q.alternativas.slice(0, 5).map((t, i) => ({ letra: String.fromCharCode(65 + i), texto: marksToHtml(t.replace(/^\s*[A-Ea-e]\s*[).:-]\s*/, '')), imagens: [] as string[] }));
  const gabarito = q.gabarito.trim().slice(0, 1).toUpperCase();
  const valid = ce ? ['C', 'E'].includes(gabarito) : alternativas.some((a) => a.letra === gabarito) && alternativas.length >= 4;
  // Comando que fala em termo destacado sem marcar nenhum: a questão não tem como ser respondida.
  if (!valid || q.enunciado.trim().length < 20 || missingMark(q.enunciado)) return null;
  return {
    payload: {
      // O formato das questões do banco é HTML: texto escapado, e o trecho marcado em negrito.
      qid: p.qid, enunciado: marksToHtml(q.enunciado.trim()), tipo: ce ? 'certo e errado' : 'multipla escolha', dificuldade: '4', alternativas,
      textos: [] as string[], anexos: [] as string[], prova: { banca: GENERATED_BANCA, ano: p.year, orgao: '', cargo: '' },
      materia: p.materia, assunto: p.assunto, ia_tema: p.theme, ia_versao: GENERATED_PROMPT_VERSION,
      // Quantos artigos oficiais a IA recebeu: tema que cita artigos só reaproveita questões feitas com o texto da lei.
      ia_fontes: p.sources ?? 0,
    },
    gabarito,
  };
}
