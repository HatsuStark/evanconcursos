// Triagem de relevância: o assunto da Quest API é largo demais para o tema de uma sessão (ex.: "Prazos" junta a contagem dos
// arts. 798 e 798-A do CPP com os prazos do procedimento ordinário, arts. 394 a 403). Antes de mostrar o lote, a IA confere
// cada questão contra o tema e descarta a que cobra outro tema. Rigorosa: na dúvida, sai. Sem questão real no tema, a sessão
// recebe questões inéditas da IA (generated.ts): o estudante prefere isso a responder fora do tema.
import { z } from 'zod';
import { normalizeText } from '../ai/notice.ts';

export const RELEVANCE_PROMPT_VERSION = 'qrel-v1';
const TEXT_MAX = 700, OPTION_MAX = 220;

export const RelevanceVerdicts = z.object({
  avaliacoes: z.array(z.object({
    id: z.string(),
    treina_o_tema: z.boolean().describe('true se a questão cobra o tema da sessão (no comando ou na maioria das alternativas).'),
    motivo: z.string().describe('Em até 12 palavras.'),
  })),
});
export const relevanceJsonSchema = () => z.toJSONSchema(RelevanceVerdicts, { target: 'draft-7' });

export interface JudgedQuestion { id: string; assunto: string; enunciado: string; alternativas: string[] }
const plain = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

export function relevancePrompt(s: { subject: string; title: string; keyword: string }, questions: JudgedQuestion[]) {
  return `Você é professor de cursinho para concursos e confere se cada questão serve para treinar uma sessão de estudo.
Disciplina: ${s.subject}
Tema da sessão: ${s.title}
Palavra-chave: ${s.keyword || '—'}
Regras:
- treina_o_tema = true quando o comando ou a maioria das alternativas cobra o tema da sessão (artigos, institutos e regras dele).
- treina_o_tema = false quando a questão cobra outro tema da matéria, mesmo com palavras parecidas (ex.: sessão sobre contagem de prazos dos arts. 798 e 798-A do CPP e questão sobre os prazos do procedimento ordinário, arts. 394 a 403).
- Questão mista, com parte das alternativas no tema: true só se o tema decide a resposta; senão false.
- Questão que junta vários assuntos da matéria (ex.: V ou F sobre temas diferentes) ou cobra instituto vizinho (prescrição numa sessão de prazos processuais): false.
- Na dúvida, false: quando faltar questão no tema, o app cria questões inéditas sobre ele.
Questões (devolva uma avaliação para cada id):
${questions.map((q) => `id=${q.id} · assunto no banco: ${q.assunto || '—'}\n${plain(q.enunciado).slice(0, TEXT_MAX)}${q.alternativas.length ? `\n${q.alternativas.map((a, i) => `${String.fromCharCode(65 + i)}) ${plain(a).slice(0, OPTION_MAX)}`).join('\n')}` : ''}`).join('\n\n')}`;
}

// Corte de assunto ruim: o descarte já pago (6 créditos por questão) mostra quais assuntos do banco trazem outro tema para
// a sessão. Com 5 ou mais questões julgadas e 60% ou mais descartadas, a sessão para de comprar daquele assunto; a parte
// dele vai para os outros assuntos e, sem nenhum, para as questões inéditas da IA (sem créditos).
export const PRUNE_MIN_JUDGED = 5, PRUNE_REJECT_SHARE = 0.6;
export function prunedAssuntos(verdicts: { assunto: string; relevant: boolean }[]) {
  const by = new Map<string, { n: number; bad: number }>();
  for (const v of verdicts) {
    const k = normalizeText(v.assunto);
    if (!k) continue;
    const e = by.get(k) ?? { n: 0, bad: 0 };
    e.n++; if (!v.relevant) e.bad++;
    by.set(k, e);
  }
  return new Set([...by].filter(([, e]) => e.n >= PRUNE_MIN_JUDGED && e.bad / e.n >= PRUNE_REJECT_SHARE).map(([k]) => k));
}

// Só descarta o que a IA marcou como fora do tema; id sem avaliação fica (na dúvida, fica).
export function rejectedIds(verdicts: z.infer<typeof RelevanceVerdicts>, ids: string[]) {
  const wanted = new Set(ids);
  return new Map(verdicts.avaliacoes.filter((a) => wanted.has(a.id) && a.treina_o_tema === false).map((a) => [a.id, a.motivo.slice(0, 300)]));
}
