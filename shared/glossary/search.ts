// Dicionário de termos (balão à esquerda do app): busca no glossário próprio enquanto o estudante digita.
// Sem acento e sem caixa: "Usucapiao" acha "usucapião". O que não está no glossário vai para a IA (função "glossary").

export interface GlossaryEntry {
  term: string;
  area: string; // ramo: "Direito Civil", "Português", "Latim jurídico"...
  definition: string;
  note?: string; // base legal ou exemplo curto
  see?: string[]; // veja também
  aliases?: string[]; // sinônimos e siglas que também acham o termo
}

export const normalizeTerm = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Ordem: igual ao termo (ou sinônimo) → começa com a busca → alguma palavra começa com a busca → contém a busca.
export function searchGlossary(entries: GlossaryEntry[], query: string, limit = 8): GlossaryEntry[] {
  const q = normalizeTerm(query);
  if (q.length < 2) return [];
  const ranked: { e: GlossaryEntry; rank: number }[] = [];
  for (const e of entries) {
    let best = Infinity;
    for (const name of [e.term, ...(e.aliases ?? [])]) {
      const n = normalizeTerm(name);
      const rank = n === q ? 0 : n.startsWith(q) ? 1 : n.split(' ').some((w) => w.startsWith(q)) ? 2 : n.includes(q) ? 3 : Infinity;
      best = Math.min(best, rank);
    }
    if (best < Infinity) ranked.push({ e, rank: best });
  }
  return ranked.sort((a, b) => a.rank - b.rank || a.e.term.localeCompare(b.e.term, 'pt-BR')).slice(0, limit).map((r) => r.e);
}

// Termo exato (ou sinônimo), para abrir a definição direto ao clicar em "veja também" ou consultar uma seleção.
export function findExact(entries: GlossaryEntry[], query: string): GlossaryEntry | null {
  const q = normalizeTerm(query);
  return entries.find((e) => [e.term, ...(e.aliases ?? [])].some((n) => normalizeTerm(n) === q)) ?? null;
}
