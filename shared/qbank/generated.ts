// Questões inéditas da IA para a sessão: o plano B quando o banco de questões não tem mais questão no tema (a triagem de
// relevância descarta as de outro tema). Seguem o formato e o estilo da banca, cobram só o tema da sessão e se apoiam
// nos artigos oficiais da lei seca. Ficam no mesmo cache das questões reais (qid "ia-…"), então correção, caderno de
// erros, explicação e comentários funcionam igual, e são reaproveitadas entre estudantes com o mesmo tema.
import { z } from 'zod';
import { normalizeText } from '../ai/notice.ts';

export const GENERATED_PROMPT_VERSION = 'qgen-v1';
export const GENERATED_BANCA = 'Inédita (IA)';
export const GENERATED_MAX = 5;

export const GeneratedQuestions = z.object({
  questoes: z.array(z.object({
    enunciado: z.string(),
    alternativas: z.array(z.string()).describe('5 alternativas sem a letra; vazio em certo ou errado.'),
    gabarito: z.string().describe('Letra correta (A a E) ou C/E em certo ou errado.'),
  })),
});
export const generatedJsonSchema = () => z.toJSONSchema(GeneratedQuestions, { target: 'draft-7' });

export interface GenSource { ref: string; text: string }
// Chave do tema: a mesma sessão (matéria + título) reaproveita as questões já criadas, de qualquer estudante.
export const generatedTheme = (materia: string, title: string) => normalizeText(`${materia} | ${title}`);

export function generatedPrompt(p: { banca: string; cargo: string; subject: string; title: string; keyword: string; law: GenSource[]; format: string; n: number; avoid: string[] }) {
  const ce = /certo/i.test(p.format);
  return `Você é professor especialista em concursos e elabora questões inéditas no estilo da banca ${p.banca || 'do concurso'}${p.cargo ? `, para o cargo ${p.cargo}` : ''}.
Disciplina: ${p.subject}
Tema da sessão (cobre SOMENTE este tema): ${p.title}
Palavra-chave: ${p.keyword || '—'}
${p.law.length ? `Trechos oficiais da lei (única fonte legal permitida):\n${p.law.map((l) => `[${l.ref}] ${l.text}`).join('\n\n')}` : 'Nenhum trecho de lei foi fornecido: cobre só regras e conceitos que você tem certeza de que estão em vigor, sem citar número de artigo.'}
${p.avoid.length ? `Questões já criadas para este tema (não repita o que elas cobram nem a forma):\n${p.avoid.map((e) => `- ${e.slice(0, 200)}`).join('\n')}` : ''}
Regras:
- Crie ${p.n} questões ${ce ? 'de certo ou errado (alternativas vazias; gabarito "C" ou "E")' : 'de múltipla escolha com 5 alternativas (gabarito A a E)'}, de dificuldade média ou difícil, como cairiam na prova.
- Cada questão cobra o tema da sessão: nada de outros assuntos da matéria, mesmo parecidos.
- Fundamente nos trechos fornecidos: não invente prazos, números ou regras. Não cite jurisprudência, súmulas ou doutrina.
- Uma única resposta correta, sem ambiguidade; distratores plausíveis, com as trocas que a banca costuma fazer (prazo, exceção, sujeito, consequência).
- Varie o que cada questão cobra e alterne o gabarito.
- Sem markdown e sem letras antes das alternativas.`;
}

// Questão no formato público das questões reais, mais a marca do tema para reaproveitar.
export function toPublic(q: z.infer<typeof GeneratedQuestions>['questoes'][number], p: { qid: string; format: string; materia: string; assunto: string; theme: string; year: number }) {
  const ce = /certo/i.test(p.format) || !q.alternativas.length;
  const alternativas = ce ? [{ letra: 'C', texto: 'Certo', imagens: [] as string[] }, { letra: 'E', texto: 'Errado', imagens: [] as string[] }]
    : q.alternativas.slice(0, 5).map((t, i) => ({ letra: String.fromCharCode(65 + i), texto: t.replace(/^\s*[A-Ea-e]\s*[).:-]\s*/, ''), imagens: [] as string[] }));
  const gabarito = q.gabarito.trim().slice(0, 1).toUpperCase();
  const valid = ce ? ['C', 'E'].includes(gabarito) : alternativas.some((a) => a.letra === gabarito) && alternativas.length >= 4;
  if (!valid || q.enunciado.trim().length < 20) return null;
  return {
    payload: {
      qid: p.qid, enunciado: q.enunciado.trim(), tipo: ce ? 'certo e errado' : 'multipla escolha', dificuldade: '4', alternativas,
      textos: [] as string[], anexos: [] as string[], prova: { banca: GENERATED_BANCA, ano: p.year, orgao: '', cargo: '' },
      materia: p.materia, assunto: p.assunto, ia_tema: p.theme,
    },
    gabarito,
  };
}
