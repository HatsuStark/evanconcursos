// Dicas em graus nas questões do banco (antes de responder). A IA escreve tudo de uma vez, uma vez por questão
// (compartilhado entre estudantes, em qbank_questions.hints); o servidor entrega só até o grau pedido e registra o grau
// usado, que entra na tentativa (question_attempts.hint_level), no caderno de erros e no desempenho.
//   grau 1: pista (a regra ou o raciocínio a usar)
//   grau 2: múltipla escolha → descarta alternativas erradas, com o motivo; certo/errado → o trecho a conferir
//   grau 3: explicação breve da regra, sem dizer a resposta
// Grau sem conteúdo aproveitável (vazou a resposta, descarte inválido) sai, e os seguintes sobem.
import { z } from 'zod';

// hint-v1: primeira versão.
export const HINT_PROMPT_VERSION = 'hint-v1';

export const Hints = z.object({
  pista: z.string().describe('Grau 1: a regra, o instituto ou o raciocínio a usar, numa frase, sem sinônimo nem pedaço da resposta.'),
  foco: z.string().describe('Só em certo ou errado: a palavra ou o trecho do item que decide se ele está certo, sem dizer se está. Múltipla escolha: vazio.'),
  descartes: z.array(z.object({
    letra: z.string(),
    motivo: z.string().describe('Por que esta alternativa está errada, em 1 frase curta.'),
  })).describe('Só em múltipla escolha: as alternativas erradas mais fáceis de eliminar primeiro, com o motivo. Nunca a do gabarito.'),
  conceito: z.string().describe('Grau 3: a regra que decide a questão explicada em 2 a 3 frases, sem dizer qual alternativa é a correta nem se o item está certo.'),
});
export type Hints = z.infer<typeof Hints>;
export const hintsJsonSchema = () => z.toJSONSchema(Hints, { target: 'draft-7' });

export function hintsPrompt(p: { banca: string; enunciado: string; alternativas: { letra: string; texto: string }[]; gabarito: string; textos: string[]; lei: { ref: string; text: string }[]; assunto?: string }) {
  const ce = isTrueFalse(p.alternativas);
  return `Você é professor de cursinho para concursos. O estudante está resolvendo a questão abaixo e pediu ajuda ANTES de responder. Escreva dicas em graus crescentes que o levem a raciocinar até a resposta, sem nunca entregá-la.
${p.assunto ? `Assunto: ${p.assunto}\n` : ''}${p.textos.length ? `Texto associado:\n${p.textos.join('\n').slice(0, 3000)}\n` : ''}Questão (${p.banca || 'banca não informada'}):
${p.enunciado}
${ce ? '(Questão de certo ou errado.)' : p.alternativas.map((a) => `${a.letra}) ${a.texto}`).join('\n')}
Gabarito oficial (só para você; o estudante não pode descobrir por nenhuma dica): ${p.gabarito}
${p.lei.length ? `Trechos oficiais da lei (única fonte legal):\n${p.lei.map((l) => `[${l.ref}] ${l.text}`).join('\n\n').slice(0, 8000)}` : 'Nenhum trecho de lei foi fornecido: não cite números de artigos.'}
Regras:
- Nenhuma dica diz qual é a alternativa correta, se o item está certo ou errado, nem repete o texto da alternativa correta. Não use as palavras "gabarito", "correta", "incorreta", "certo" ou "errado" para falar da questão.
- pista: aponta a regra, o instituto ou o raciocínio (ex.: "Pense em quem tem a competência para rever o próprio ato."). Uma frase.
${ce
    ? '- foco: a palavra ou o trecho do item que decide a questão (ex.: "Repare no prazo e em quem o conta."), sem dizer se está certo. descartes: lista vazia.'
    : '- descartes: as alternativas erradas, da mais fácil de eliminar para a mais difícil, cada uma com o motivo em 1 frase. Nunca a alternativa do gabarito. foco: vazio.'}
- conceito: explique a regra que decide a questão em 2 a 3 frases, como para quem nunca viu o tema, sem aplicá-la ao caso a ponto de revelar a resposta.
- Cálculo ou raciocínio lógico: a pista diz o primeiro passo; o conceito, a fórmula ou o método, sem fazer a conta final.
- Cite artigos somente dos trechos fornecidos. Não cite jurisprudência nem autores. Linguagem simples, sem markdown.`;
}

export const isTrueFalse = (alternativas: { letra: string }[]) => !alternativas.length || alternativas.every((a) => /^[CE]$/i.test(a.letra.trim()));
const letterOf = (s: string) => s.trim().charAt(0).toUpperCase();

// Frase que entrega a resposta: cita a letra como resposta, fala em gabarito, ou julga o item.
const LEAK = [
  /\bgabarito\b/i,
  /\b(?:alternativa|letra|op[çc][ãa]o)\s*["“(]?[A-E]\b/i,
  /\b(?:resposta|alternativa)\s+(?:correta|certa)\b/i,
  /\bo\s+item\s+(?:est[áa]\s+)?(?:certo|errado|correto|incorreto)\b/i,
  /\b(?:a\s+)?afirma[çc][ãa]o\s+(?:est[áa]\s+)?(?:certa|errada|correta|incorreta)\b/i,
];
const leaks = (s: string) => LEAK.some((r) => r.test(s));
const clean = (s: string, max: number) => { const t = s.replace(/\s+/g, ' ').trim().slice(0, max); return t && !leaks(t) ? t : ''; };

export type HintStep =
  | { kind: 'pista' | 'foco' | 'conceito'; text: string }
  | { kind: 'descarte'; itens: { letra: string; motivo: string }[] };

// Quantas alternativas o grau 2 elimina: metade das erradas, arredondada para baixo, e sempre sobram pelo menos 2.
export const discardCount = (n: number) => (n < 3 ? 0 : Math.min(Math.floor((n - 1) / 2), n - 2));

// Os graus aproveitáveis, na ordem. O motivo do descarte não é conferido contra vazamento: ele fala de uma alternativa
// errada, e "está errada porque..." é exatamente o que deve dizer.
export function hintSteps(h: Hints, q: { gabarito: string; alternativas: { letra: string }[] }): HintStep[] {
  const steps: HintStep[] = [];
  const pista = clean(h.pista, 300);
  if (pista) steps.push({ kind: 'pista', text: pista });
  if (isTrueFalse(q.alternativas)) {
    const foco = clean(h.foco, 300);
    if (foco) steps.push({ kind: 'foco', text: foco });
  } else {
    const right = letterOf(q.gabarito), valid = new Set(q.alternativas.map((a) => letterOf(a.letra)));
    const seen = new Set<string>();
    const itens = h.descartes
      .map((d) => ({ letra: letterOf(d.letra), motivo: d.motivo.replace(/\s+/g, ' ').trim().slice(0, 300) }))
      .filter((d) => d.letra !== right && valid.has(d.letra) && d.motivo && !seen.has(d.letra) && seen.add(d.letra))
      .slice(0, discardCount(q.alternativas.length));
    if (itens.length) steps.push({ kind: 'descarte', itens });
  }
  const conceito = clean(h.conceito, 700);
  if (conceito) steps.push({ kind: 'conceito', text: conceito });
  return steps;
}
