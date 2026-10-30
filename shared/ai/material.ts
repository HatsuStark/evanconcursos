// Mapeamento de uma apostila (PDF do estudante) para as sessões do cronograma: índice compacto das
// páginas (início do texto de cada página), prompt versionado e validação dos intervalos.
import { z } from 'zod';

export const MATERIAL_PROMPT_VERSION = 'material-v2';
const PAGE_CHARS = 280, MAX_INDEX_CHARS = 160_000;

export const MaterialMap = z.object({
  mapa: z.array(z.object({
    sessao: z.string().describe('Código da sessão (S1, S2...), exatamente como recebido.'),
    inicio: z.number().int().describe('Primeira página onde o conteúdo da sessão é explicado.'),
    fim: z.number().int().describe('Última página desse trecho.'),
  })),
});
export type MaterialMap = z.infer<typeof MaterialMap>;
export const materialJsonSchema = () => z.toJSONSchema(MaterialMap, { target: 'draft-7' });

// Índice: "p.12: começo do texto da página" (cabe numa chamada mesmo para apostilas grandes).
// Linhas repetidas em muitas páginas (cabeçalho, rodapé, nome do curso) são removidas antes: senão o
// começo de toda página é igual e a IA não vê o assunto.
export function pageIndex(pages: string[]): string {
  const lines = pages.map((t) => t.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean));
  const freq = new Map<string, number>();
  for (const ls of lines) for (const l of new Set(ls.map((x) => x.replace(/\d+/g, '#')))) freq.set(l, (freq.get(l) ?? 0) + 1);
  const repeated = (l: string) => pages.length >= 4 && (freq.get(l.replace(/\d+/g, '#')) ?? 0) >= Math.max(3, pages.length * 0.3);
  const per = Math.max(80, Math.min(PAGE_CHARS * 4, Math.floor(MAX_INDEX_CHARS / Math.max(1, pages.length))));
  return lines.map((ls, i) => `p.${i + 1}: ${ls.filter((l) => !repeated(l)).join(' ').slice(0, per)}`).join('\n');
}
// Páginas com texto: se quase nenhuma tem, é PDF escaneado (só imagem).
export const hasText = (pages: string[]) => pages.filter((t) => t.replace(/\s/g, '').length > 40).length >= Math.max(1, pages.length * 0.3);

export function materialPrompt(sessions: { code: string; subject: string; title: string }[], index: string, pages: number) {
  return `Você organiza a apostila de um estudante de concurso. Abaixo estão as sessões do cronograma e o início do texto de cada página da apostila (${pages} páginas).
Sessões:
${sessions.map((s) => `${s.code} | ${s.subject} | ${s.title}`).join('\n')}
Páginas da apostila:
${index}
Para cada sessão, indique o trecho de páginas (início e fim) onde o conteúdo dela aparece na apostila: explicação, teoria, texto de lei ou exercícios do assunto.
Regras: use só páginas existentes (1 a ${pages}); um trecho contínuo por sessão (o principal); omita sessões cujo assunto não aparece; não invente.`;
}

// Mantém só sessões conhecidas e páginas válidas; trecho de no máximo 120 páginas.
export function validateMap(m: MaterialMap, codes: Set<string>, pages: number) {
  const out: { code: string; from: number; to: number }[] = [];
  for (const x of m.mapa) {
    const code = x.sessao.trim().toUpperCase();
    if (!codes.has(code)) continue;
    const from = Math.max(1, Math.min(pages, Math.round(x.inicio))), to = Math.max(from, Math.min(pages, Math.round(x.fim), from + 119));
    if (!out.some((o) => o.code === code)) out.push({ code, from, to });
  }
  return out;
}
