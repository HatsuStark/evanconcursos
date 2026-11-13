// Artigos relacionados da apostila: os que ela cita sem estarem nos trechos da sessão (a IA escreveu de memória). O servidor
// busca o texto oficial de cada um e a IA, só com esse texto e o tema, diz se a frase da apostila confere com o artigo e
// como ele complementa o tema. O que não confere fica só com o aviso de conferir.
import { z } from 'zod';
import { findLawRefs, inRanges } from '../legal/refs.ts';
import { lawByKey, type LawEntry } from '../legal/registry.ts';
import type { ProvidedArticle } from './guide.ts';

// v2: resumo do trecho citado, mostrado entre parênteses no próprio texto da apostila.
export const RELATED_PROMPT_VERSION = 'related-v2';
// Por apostila: os primeiros citados. Intervalo grande ("arts. 1º a 30") é menção de passagem, não artigo a explicar.
export const RELATED_MAX = 6;
// O trecho guarda a frase inteira (o resumo é encaixado nela); para a IA vai até CONTEXT_MAX, em volta da citação.
const RANGE_MAX = 3, CONTEXT_MAX = 600, TRECHO_MAX = 2000, TEXT_MAX = 1200;

export interface OutsideRef { lawKey: string; num: number; suffix: string; ref: string; context: string }
// trecho: a frase da apostila que cita o artigo (onde o resumo entra). resumo e trecho faltam nos feitos pela related-v1.
export interface RelatedArticle { ref: string; texto: string; explicacao: string; confere: boolean; resumo?: string; trecho?: string }

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
        if (hit) out.set(ref, { lawKey: r.law, num: n, suffix, ref, context: hit.s.slice(0, TRECHO_MAX) });
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
    resumo: z.string().describe('Com confere true: o que diz o trecho citado na frase (só os incisos ou parágrafos citados), em até 30 palavras. Com false: vazio.'),
  })),
});
export type RelatedVerdicts = z.infer<typeof RelatedVerdicts>;
export const relatedJsonSchema = () => z.toJSONSchema(RelatedVerdicts, { target: 'draft-7' });

// Frase longa: só a parte em volta da citação do artigo.
function around(context: string, ref: string) {
  if (context.length <= CONTEXT_MAX) return context;
  const num = refNum(ref)?.num, at = num ? context.search(new RegExp(`(?<!\\d)${num}(?!\\d)`)) : -1;
  const from = Math.max(0, Math.min(context.length - CONTEXT_MAX, (at < 0 ? 0 : at) - CONTEXT_MAX / 2));
  return `${from ? '…' : ''}${context.slice(from, from + CONTEXT_MAX)}${from + CONTEXT_MAX < context.length ? '…' : ''}`;
}

export function relatedPrompt(s: { subject: string; title: string }, items: { ref: string; context: string; text: string }[]) {
  return `Você é professor de cursinho para concursos. A apostila do tema abaixo cita artigos que não estão entre os trechos de lei da sessão. Para cada um, você recebe a frase da apostila que o cita e o texto oficial do artigo.
Disciplina: ${s.subject}
Tema da sessão: ${s.title}
Para cada artigo (devolva um item por colchete):
- confere: true se o que a frase diz sobre o artigo bate com o texto oficial; false se a frase atribui ao artigo algo que ele não diz (número trocado, conteúdo de outro artigo, regra que não está nele). Também false se o artigo não tem relação com o tema da sessão (citado por engano ou de passagem, sem nada a acrescentar). Frase que só menciona um artigo ligado ao tema, sem dizer o que ele traz, confere.
- explicacao: com confere true, 1 ou 2 frases curtas (até 45 palavras), em linguagem simples: o que o artigo estabelece e como ele se liga ao tema da sessão (complementa, excepciona, define um conceito usado, traz o requisito, o procedimento ou a pena). Use só o texto oficial e o tema: não cite outros artigos, jurisprudência ou doutrina, e não invente prazos ou números. Com confere false, vazio.
- resumo: com confere true, o que diz o trecho do artigo que a frase cita, para ler entre parênteses logo depois da citação (até 30 palavras, sem repetir o número do artigo, sem ponto final). Se a frase cita incisos, parágrafos ou alíneas, resuma só eles (vários incisos: separe por ponto e vírgula); se cita o artigo inteiro, resuma a regra principal. Fiel ao texto oficial: mantenha prazos, números, sujeitos e exceções; pode simplificar as palavras. Com confere false, vazio.
Artigos:
${items.map((i) => `[${i.ref}]\nFrase da apostila: ${around(i.context, i.ref)}\nTexto oficial: ${i.text.slice(0, TEXT_MAX)}`).join('\n\n')}`;
}

const key = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

// Junta o veredito ao texto oficial, na ordem dos artigos enviados. Artigo sem veredito fica como não conferido.
export function mergeRelated(items: { ref: string; text: string; context?: string }[], v: RelatedVerdicts): RelatedArticle[] {
  const by = new Map(v.itens.map((i) => [key(i.ref), i]));
  return items.map((i, k) => {
    const x = by.get(key(i.ref)) ?? (v.itens.length === items.length ? v.itens[k] : undefined);
    const confere = !!x?.confere && !!x.explicacao.trim();
    return {
      ref: i.ref, texto: i.text.slice(0, TEXT_MAX), explicacao: confere ? x!.explicacao.trim() : '', confere,
      resumo: confere ? (x!.resumo ?? '').trim().replace(/[.\s]+$/, '') : '', trecho: i.context ?? '',
    };
  });
}

// ---------- resumo no texto ----------
// Onde entra o resumo de cada artigo conferido: logo depois da citação, incluindo os incisos, parágrafos e a lei que vêm
// junto ("art. 311, incisos II e III, do CPC" → depois de "CPC"). Artigo numa lista ("arts. 20 e 21") entra depois da
// lista. Em cada parágrafo ou item que cita o artigo, uma vez (na primeira citação dele ali), desde que a citação não
// venha com outra lei escrita.
const ART = /\b(?:arts?\.|artigos?)\s*/gi;
const LIST = String.raw`(?:\d{1,4}(?:\.\d{3})*(?:\s*[º°])?(?:\s*-\s*[A-Z]{1,2}\b)?(?:\s*(?:,|e|a|ao)\s*(?=\d))?\s*)+`;
const PARTS = String.raw`(?:,?\s*(?:incisos?|inc\.|§§?|par[áa]grafos?(?:\s+[úu]nico)?|caput|al[íi]neas?)(?:\s*(?:[IVXLC]+\b|\d+[º°]?|[a-z]\))(?:\s*(?:,|e|a)\s*)?)*)*`;
const LAW = String.raw`(?:,?\s*\b(?:do|da|desta|deste)\s+(?:CPC|CPP|CP|CF|CC|CLT|CTN|CDC|ECA|LINDB|LEP|Constitui[çc][ãa]o(?:\s+Federal)?|C[óo]digo(?:\s+(?:de|do|da|Civil|Penal|Tribut[áa]rio|Processo|Eleitoral|Militar|Defesa|Consumidor|Tr[âa]nsito))+|Lei\s+(?:n[º°.]*\s*)?\d{1,2}\.?\d{3}(?:\/\d{2,4})?))?`;
const CITE = new RegExp(`^(${LIST})(${PARTS})(${LAW})`, 'i');

export const refNum = (ref: string) => {
  const m = /art\. (\d+)(?:-([A-Z]+))?$/.exec(ref);
  return m ? { num: Number(m[1]), suffix: m[2] ?? '' } : null;
};

const lawToken = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
// Posição logo depois da citação do artigo dentro de text[from, to); -1 se não há. anyLaw: aceita citação com outra lei escrita.
function citeEnd(text: string, from: number, to: number, ref: string, anyLaw: boolean) {
  const n = refNum(ref);
  if (!n) return -1;
  const part = text.slice(from, to), short = lawToken(ref.slice(0, ref.lastIndexOf(', art.')));
  for (const m of part.matchAll(ART)) {
    const at = m.index! + m[0].length, c = CITE.exec(part.slice(at));
    if (!c) continue;
    const nums = [...c[1]!.matchAll(/(\d{1,4}(?:\.\d{3})*)(?:\s*[º°])?(?:\s*-\s*([A-Z]{1,2})\b)?/g)].map((x) => ({ num: Number(x[1]!.replace(/\./g, '')), suffix: x[2] ?? '' }));
    // "arts. 20 a 23": o intervalo conta.
    const inList = nums.some((x) => x.num === n.num && x.suffix === n.suffix) || (/\ba\b/.test(c[1]!) && nums.length === 2 && n.num > nums[0]!.num && n.num < nums[1]!.num);
    if (!inList || (!anyLaw && c[3] && !lawToken(c[3]).includes(short))) continue;
    return from + at + c[0].replace(/[\s,]+$/, '').length;
  }
  return -1;
}

export type Notes = { at: number; items: RelatedArticle[] }[];
// Para os textos na ordem da tela, os resumos de cada um (pela posição na lista).
export function planNotes(texts: string[], related: RelatedArticle[]): Map<number, Notes> {
  const placed = new Map<number, Map<number, RelatedArticle[]>>();
  const put = (i: number, pos: number, r: RelatedArticle) => {
    const m = placed.get(i) ?? new Map<number, RelatedArticle[]>();
    m.set(pos, [...(m.get(pos) ?? []), r]);
    placed.set(i, m);
  };
  for (const r of related.filter((x) => x.confere && x.resumo)) {
    // Em todo texto que cita o artigo, na primeira citação dele: no texto do trecho, a citação do trecho (vale mesmo com
    // a lei escrita de outro jeito, "do Código Penal"); nos demais, a primeira sem outra lei escrita.
    for (let i = 0; i < texts.length; i++) {
      const t = texts[i]!, start = r.trecho ? t.indexOf(r.trecho) : -1;
      const inTrecho = start >= 0 ? citeEnd(t, start, start + r.trecho!.length, r.ref, true) : -1;
      const pos = inTrecho >= 0 ? inTrecho : citeEnd(t, 0, t.length, r.ref, false);
      if (pos >= 0) put(i, pos, r);
    }
  }
  return new Map([...placed].map(([i, m]) => [i, [...m].sort((a, b) => a[0] - b[0]).map(([at, items]) => ({ at, items }))]));
}

// Citações ainda por conferir: as do `unverified` que não viraram artigo relacionado conferido.
export function stillUnverified(unverified: string[], related: RelatedArticle[] | null | undefined) {
  const ok = new Set((related ?? []).filter((r) => r.confere).map((r) => key(r.ref)));
  return unverified.filter((u) => !ok.has(key(u)));
}
