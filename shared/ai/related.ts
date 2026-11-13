// Artigos relacionados da apostila: os que ela cita sem estarem nos trechos da sessão (a IA escreveu de memória). O servidor
// busca o texto oficial de cada um e a IA, só com esse texto e o tema, diz se a frase da apostila confere com o artigo e
// como ele complementa o tema. O que não confere fica só com o aviso de conferir.
import { z } from 'zod';
import { findLawRefs, inRanges } from '../legal/refs.ts';
import { lawByKey, type LawEntry } from '../legal/registry.ts';
import type { ProvidedArticle } from './guide.ts';

export const RELATED_PROMPT_VERSION = 'related-v1';
// Por apostila: os primeiros citados. Intervalo grande ("arts. 1º a 30") é menção de passagem, não artigo a explicar.
export const RELATED_MAX = 6;
const RANGE_MAX = 3, CONTEXT_MAX = 400, TEXT_MAX = 1200;

export interface OutsideRef { lawKey: string; num: number; suffix: string; ref: string; context: string }
export interface RelatedArticle { ref: string; texto: string; explicacao: string; confere: boolean }

// Frases (o ponto de "art. 77" não separa: depois dele vem número, não maiúscula).
const sentences = (text: string) => text.split(/\n+|(?<=[.;!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ"(])/).map((s) => s.trim()).filter(Boolean);

// Artigos citados fora dos trechos fornecidos, cada um com a primeira frase que o cita. Mesmo formato de referência do
// `unverified` da apostila ("CP, art. 77"), para o aviso de conferir saber quais já foram explicados.
// A lei de cada artigo sai do texto inteiro, como no `unverified`: numa frase solta, "o art. 4º" perde a lei citada antes
// e cairia na lei padrão da matéria. As frases dão o contexto e confirmam a lei.
export function outsideRefs(text: string, provided: ProvidedArticle[], subject = '', extra: LawEntry[] = [], max = RELATED_MAX): OutsideRef[] {
  const out = new Map<string, OutsideRef>();
  let sents: { s: string; refs: ReturnType<typeof findLawRefs> }[] | null = null;
  for (const r of findLawRefs(text, subject, extra)) {
    for (const range of r.ranges) {
      if (range.to - range.from >= RANGE_MAX) continue;
      for (let n = range.from; n <= range.to; n++) {
        const suffix = range.from === range.to ? range.fromSuffix ?? '' : '';
        if (provided.some((p) => p.lawKey === r.law && p.num === n && (p.suffix ?? '') === suffix)) continue;
        const ref = `${lawByKey(r.law, extra)?.short ?? r.law}, art. ${n}${suffix ? `-${suffix}` : ''}`;
        if (out.has(ref)) continue;
        sents ??= sentences(text).map((s) => ({ s, refs: findLawRefs(s, subject, extra) }));
        // Sem frase que cite o artigo com essa lei, a lei veio de outra menção no texto (atribuição errada): fica de fora.
        const hit = sents.find((x) => x.refs.some((y) => y.law === r.law && y.ranges.some((g) => inRanges([g], n, suffix))));
        if (hit) out.set(ref, { lawKey: r.law, num: n, suffix, ref, context: hit.s.slice(0, CONTEXT_MAX) });
      }
    }
  }
  return [...out.values()].slice(0, max);
}

export const RelatedVerdicts = z.object({
  itens: z.array(z.object({
    ref: z.string().describe('Exatamente como no colchete.'),
    confere: z.boolean().describe('true se o que a frase da apostila diz do artigo bate com o texto oficial.'),
    explicacao: z.string().describe('Com confere true: o que o artigo estabelece e como se liga ao tema, em 1 ou 2 frases. Com false: vazio.'),
  })),
});
export type RelatedVerdicts = z.infer<typeof RelatedVerdicts>;
export const relatedJsonSchema = () => z.toJSONSchema(RelatedVerdicts, { target: 'draft-7' });

export function relatedPrompt(s: { subject: string; title: string }, items: { ref: string; context: string; text: string }[]) {
  return `Você é professor de cursinho para concursos. A apostila do tema abaixo cita artigos que não estão entre os trechos de lei da sessão. Para cada um, você recebe a frase da apostila que o cita e o texto oficial do artigo.
Disciplina: ${s.subject}
Tema da sessão: ${s.title}
Para cada artigo (devolva um item por colchete):
- confere: true se o que a frase diz sobre o artigo bate com o texto oficial; false se a frase atribui ao artigo algo que ele não diz (número trocado, conteúdo de outro artigo, regra que não está nele). Também false se o artigo não tem relação com o tema da sessão (citado por engano ou de passagem, sem nada a acrescentar). Frase que só menciona um artigo ligado ao tema, sem dizer o que ele traz, confere.
- explicacao: com confere true, 1 ou 2 frases curtas (até 45 palavras), em linguagem simples: o que o artigo estabelece e como ele se liga ao tema da sessão (complementa, excepciona, define um conceito usado, traz o requisito, o procedimento ou a pena). Use só o texto oficial e o tema: não cite outros artigos, jurisprudência ou doutrina, e não invente prazos ou números. Com confere false, vazio.
Artigos:
${items.map((i) => `[${i.ref}]\nFrase da apostila: ${i.context}\nTexto oficial: ${i.text.slice(0, TEXT_MAX)}`).join('\n\n')}`;
}

const key = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

// Junta o veredito ao texto oficial, na ordem dos artigos enviados. Artigo sem veredito fica como não conferido.
export function mergeRelated(items: { ref: string; text: string }[], v: RelatedVerdicts): RelatedArticle[] {
  const by = new Map(v.itens.map((i) => [key(i.ref), i]));
  return items.map((i, k) => {
    const x = by.get(key(i.ref)) ?? (v.itens.length === items.length ? v.itens[k] : undefined);
    const confere = !!x?.confere && !!x.explicacao.trim();
    return { ref: i.ref, texto: i.text.slice(0, TEXT_MAX), explicacao: confere ? x!.explicacao.trim() : '', confere };
  });
}

// Citações ainda por conferir: as do `unverified` que não viraram artigo relacionado conferido.
export function stillUnverified(unverified: string[], related: RelatedArticle[] | null | undefined) {
  const ok = new Set((related ?? []).filter((r) => r.confere).map((r) => key(r.ref)));
  return unverified.filter((u) => !ok.has(key(u)));
}
