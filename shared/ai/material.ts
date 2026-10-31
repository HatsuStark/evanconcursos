// Mapeamento de uma apostila (PDF do estudante) para as sessões do cronograma: índice compacto das
// páginas (só o que ajuda a localizar os assuntos), prompt versionado e validação dos intervalos.
import { z } from 'zod';

export const MATERIAL_PROMPT_VERSION = 'material-v4';
export const MATERIAL_THINKING = 'low' as const; // localizar assuntos pede pouco raciocínio, que é a maior parte do custo
const PAGE_CHARS = 600, TOC_CHARS = 2400, START_CHARS = 160, LINE_CHARS = 200, MAX_INDEX_CHARS = 120_000, MAX_RANGES = 3;

export const MaterialMap = z.object({
  mapa: z.array(z.object({
    sessao: z.string().describe('Código da sessão (S1, S2...), exatamente como recebido.'),
    inicio: z.number().int().describe('Primeira página onde o conteúdo da sessão é explicado.'),
    fim: z.number().int().describe('Última página desse trecho.'),
  })),
});
export type MaterialMap = z.infer<typeof MaterialMap>;
export const materialJsonSchema = () => z.toJSONSchema(MaterialMap, { target: 'draft-7' });

const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const isToc = (lines: string[]) => lines.filter((l) => /\.{4,}\s*\d*$/.test(l)).length >= 2;
const isHeading = (l: string) => l.length <= 70 && /^[\p{Lu}\d]/u.test(l) && !/[.,;:]$/.test(l);

// Palavras dos títulos das sessões que distinguem assunto: as presentes em muitas páginas não ajudam.
function sessionTerms(titles: string[], pages: string[]) {
  const words = new Set(titles.flatMap((t) => plain(t).match(/\p{L}{5,}/gu) ?? []).map((w) => w.replace(/s$/, '')));
  return [...words].filter((w) => pages.filter((p) => p.includes(w)).length <= Math.max(3, pages.length * 0.25));
}

// O começo da página, as linhas que citam termos das sessões e os títulos, nessa prioridade, até o limite.
function pageExcerpt(lines: string[], per: number, terms: string[]) {
  const picked = new Set<number>();
  let used = 0;
  const take = (i: number) => { if (!picked.has(i) && used < per) { picked.add(i); used += Math.min(lines[i]!.length, LINE_CHARS) + 1; } };
  lines.forEach((_, i) => { if (used < START_CHARS) take(i); });
  lines.forEach((l, i) => { const p = plain(l); if (terms.some((t) => p.includes(t))) take(i); });
  lines.forEach((l, i) => { if (isHeading(l)) take(i); });
  let out = '', previous = -1;
  for (const i of [...picked].sort((a, b) => a - b)) {
    out += (previous < 0 ? '' : i === previous + 1 ? ' ' : ' … ') + lines[i]!.slice(0, LINE_CHARS);
    previous = i;
  }
  return out.slice(0, per);
}

// Índice: "p.12: trechos da página". Sumário vai inteiro; das outras páginas vai só o que ajuda a localizar
// os assuntos, inclusive os que começam no meio da página, e o limite encolhe em apostilas muito grandes.
// Linhas repetidas em muitas páginas (cabeçalho, rodapé, nome do curso) são removidas antes: senão o
// começo de toda página é igual e a IA não vê o assunto.
export function pageIndex(pages: string[], sessionTitles: string[] = []): string {
  const lines = pages.map((t) => t.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean));
  const freq = new Map<string, number>();
  for (const ls of lines) for (const l of new Set(ls.map((x) => x.replace(/\d+/g, '#')))) freq.set(l, (freq.get(l) ?? 0) + 1);
  const repeated = (l: string) => pages.length >= 4 && (freq.get(l.replace(/\d+/g, '#')) ?? 0) >= Math.max(3, pages.length * 0.3);
  const per = Math.max(80, Math.min(PAGE_CHARS, Math.floor(MAX_INDEX_CHARS / Math.max(1, pages.length))));
  const terms = sessionTerms(sessionTitles, pages.map(plain));
  return lines.map((ls, i) => {
    const kept = ls.filter((l) => !repeated(l));
    return `p.${i + 1}: ${isToc(kept) ? kept.join(' ').slice(0, TOC_CHARS) : pageExcerpt(kept, per, terms)}`;
  }).join('\n');
}
// O texto das páginas vem do navegador: aceita só o formato esperado, com limite por página e no total.
export function validPages(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3000 || !value.every((p) => typeof p === 'string')) return null;
  return (value as string[]).map((p) => p.slice(0, 6000));
}
// Páginas com texto: se quase nenhuma tem, é PDF escaneado (só imagem).
export const hasText = (pages: string[]) => pages.filter((t) => t.replace(/\s/g, '').length > 40).length >= Math.max(1, pages.length * 0.3);

export function materialPrompt(sessions: { code: string; subject: string; title: string }[], index: string, pages: number) {
  return `Você organiza a apostila de um estudante de concurso. Abaixo estão as sessões do cronograma e trechos de cada página da apostila (${pages} páginas): o começo, os títulos e as linhas que citam assuntos das sessões, separados por "…".
Sessões:
${sessions.map((s) => `${s.code} | ${s.subject} | ${s.title}`).join('\n')}
Páginas da apostila:
${index}
Para cada sessão, indique o trecho de páginas (início e fim) para o estudante ler o conteúdo dela na apostila: explicação, teoria ou texto de lei. Não inclua seções de questões comentadas, listas de questões, gabaritos nem resumos finais, mesmo que citem o assunto: questões têm lugar próprio no app.
Como localizar: se houver sumário, use-o para achar os assuntos, mas confirme no texto, porque a numeração impressa pode diferir de "p.N". O trecho começa na página em que o assunto é explicado e termina onde o assunto seguinte começa. Procure cada assunto pelo conteúdo: ele pode estar no meio de um capítulo com outro título.
Sessões que juntam assuntos: se os assuntos da sessão estão em lugares diferentes da apostila, devolva um item para cada lugar, com o mesmo código de sessão (até ${MAX_RANGES} por sessão). Exemplo: "Estabilidade e Petição" com estabilidade em p.56 e petição em p.117 vira dois itens, nunca um trecho que não contém nenhum dos dois. Cada trecho precisa conter de fato o assunto, mesmo que seja uma só página.
Regras: "p.N" é a única numeração válida; use só páginas existentes (1 a ${pages}); nunca use o sumário como trecho; omita sessões cujo assunto não aparece; não invente.`;
}

// Mantém só sessões conhecidas e páginas válidas; trecho de no máximo 120 páginas. Uma sessão pode ter
// mais de um trecho, sem sobreposição, porque costuma juntar assuntos de partes diferentes da apostila.
export function validateMap(m: MaterialMap, codes: Set<string>, pages: number) {
  const out: { code: string; from: number; to: number }[] = [];
  for (const x of m.mapa) {
    const code = x.sessao.trim().toUpperCase();
    if (!codes.has(code)) continue;
    const from = Math.max(1, Math.min(pages, Math.round(x.inicio))), to = Math.max(from, Math.min(pages, Math.round(x.fim), from + 119));
    const same = out.filter((o) => o.code === code);
    if (same.length < MAX_RANGES && !same.some((o) => from <= o.to && to >= o.from)) out.push({ code, from, to });
  }
  return out;
}
