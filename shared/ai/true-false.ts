// Certo ou errado da revisão da semana: assertivas no estilo de prova montadas só com o que a revisão curta do tema já diz
// (o que memorizar, pegadinhas, gatilhos, perguntas, mnemônicos e lei comentada). As erradas trocam um ponto só, do jeito
// que as pegadinhas descrevem. Uma vez por revisão curta, compartilhada entre estudantes (tabela review_true_false).
import { z } from 'zod';

// tf-v1: primeira versão.
export const TF_PROMPT_VERSION = 'tf-v1';
export const TF_ITEMS = 6, TF_MIN = 3;
const MAX_STATEMENT = 320, MAX_EXPLANATION = 300;

export const TrueFalse = z.object({
  itens: z.array(z.object({ afirmacao: z.string(), certo: z.boolean(), explicacao: z.string() })),
});
export type TrueFalseItem = z.infer<typeof TrueFalse>['itens'][number];
export const trueFalseJsonSchema = () => z.toJSONSchema(TrueFalse, { target: 'draft-7' });

export interface TfSheet {
  titulo?: string;
  memorizar?: string[]; pegadinhas?: string[]; pontos_banca?: string[]; resumo?: string[];
  gatilhos?: { pista: string; resposta: string }[];
  perguntas?: { pergunta: string; resposta: string }[];
  mnemonicos?: { alvo: string; mnemonico: string; explicacao: string }[];
  legislacao?: { ref: string; comentario: string }[];
}

const list = (label: string, items: string[]) => (items.length ? `${label}:\n${items.map((t) => `- ${t}`).join('\n')}` : '');

export function trueFalsePrompt(p: { subject: string; title: string; banca: string }, s: TfSheet) {
  const facts = [
    list('Para memorizar', s.memorizar ?? []),
    list('Pegadinhas (as trocas que a banca faz)', s.pegadinhas ?? []),
    list('O que mais cai', s.pontos_banca ?? []),
    list('Gatilhos de prova', (s.gatilhos ?? []).map((g) => `${g.pista} → ${g.resposta}`)),
    list('Perguntas de recordação', (s.perguntas ?? []).map((q) => `${q.pergunta} → ${q.resposta}`)),
    list('Mnemônicos', (s.mnemonicos ?? []).map((m) => `${m.alvo}: ${m.mnemonico} (${m.explicacao})`)),
    list('Lei comentada', (s.legislacao ?? []).map((l) => `${l.ref}: ${l.comentario}`)),
    list('Resumo', s.resumo ?? []),
  ].filter(Boolean).join('\n\n');
  return `Você é professor especialista em concursos públicos brasileiros. Monte um exercício de CERTO OU ERRADO para o candidato revisar o tema "${p.title}" (${p.subject}${p.banca ? `, banca ${p.banca}` : ''}).
Use SOMENTE os fatos da revisão abaixo: não traga regra, prazo, número, artigo ou exceção que não esteja nela.

${facts}

Regras:
- ${TF_ITEMS} assertivas, de 2 a 4 erradas, em ordem misturada. Cada uma testa um ponto diferente; prefira os que mais caem e as pegadinhas.
- Assertiva errada erra em UM ponto só e relevante (a troca de prazo, competência, exceção ou palavra que as pegadinhas descrevem); o resto da frase é verdadeiro. Nada de erro bobo, absurdo ou de português.
- Assertiva certa é afirmação completa e correta, sem ser cópia literal de uma linha da revisão.
- Estilo de prova: frase afirmativa, sem "sempre/nunca" artificiais, sem "Julgue o item" e sem perguntas. Até ${MAX_STATEMENT} caracteres.
- explicacao: até 2 frases. Na errada, diga qual é o erro e a regra correta; na certa, o porquê. Não comece por "Certo" ou "Errado" (a tela já mostra).
- Sem markdown.`;
}

const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Limpa o que a IA devolveu: texto vazio, longo demais ou repetido sai. Precisa sobrar pelo menos TF_MIN, com pelo menos
// uma certa e uma errada; senão o exercício não aparece.
export function cleanTrueFalse(items: TrueFalseItem[]): TrueFalseItem[] {
  const seen = new Set<string>();
  const out: TrueFalseItem[] = [];
  for (const it of items) {
    const afirmacao = it.afirmacao.trim().replace(/^\s*(julgue( o item)?|certo ou errado)\s*[:.-]\s*/i, '');
    const explicacao = it.explicacao.trim().replace(/^\s*(certo|errado|correto|incorreto)\s*[:.,-]\s*/i, '');
    const key = norm(afirmacao);
    if (!afirmacao || !explicacao || afirmacao.length > MAX_STATEMENT || explicacao.length > MAX_EXPLANATION * 2 || seen.has(key) || afirmacao.endsWith('?')) continue;
    seen.add(key);
    out.push({ afirmacao, certo: it.certo, explicacao: explicacao[0]!.toUpperCase() + explicacao.slice(1) });
    if (out.length === TF_ITEMS) break;
  }
  const wrong = out.filter((x) => !x.certo).length;
  return out.length >= TF_MIN && wrong >= 1 && wrong < out.length ? out : [];
}
