// Jurisprudência da sessão: entre as súmulas e teses oficiais ligadas aos artigos do tema, a IA escolhe as que mais caem
// em prova e diz, em uma frase, como a banca cobra. O texto de cada item é o oficial (legal_precedents); a IA não escreve
// jurisprudência, só escolhe e comenta. Resultado em cache compartilhado (juris_picks).
import { z } from 'zod';
import { precedentLabel, type Court, type PrecedentKind } from '../legal/juris.ts';
import type { LawRef } from '../legal/refs.ts';

export const JURIS_PROMPT_VERSION = 'juris-v1';
export const MAX_JURIS_PICKS = 12, MAX_JURIS_CANDIDATES = 60;

export interface JurisCandidate {
  id: string; court: Court; kind: PrecedentKind; number: number; text: string; subject: string; decided_on: string | null; source_url: string;
  arts: { law: string; art: number }[];
}
export interface JurisItem extends JurisCandidate { label: string; how: string; hot: boolean }

export const JurisPicks = z.object({
  itens: z.array(z.object({
    n: z.number().int().describe('Número do item na lista.'),
    como_cai: z.string().describe('Uma frase: o que a banca cobra ou a pegadinha, só com o que está no texto do item.'),
  })).describe('Os itens mais prováveis em prova para o tema, do mais para o menos cobrado.'),
});
export type JurisPicks = z.infer<typeof JurisPicks>;
export const jurisJsonSchema = () => z.toJSONSchema(JurisPicks, { target: 'draft-7' });

// Artigos da sessão no formato da função precedents_for_refs: intervalo por intervalo; sem intervalo, a lei toda.
type RefParam = { law: string; from: number | null; to: number | null };
export function refsParam(refs: LawRef[]): RefParam[] {
  return refs.flatMap<RefParam>((r) => (r.ranges.length ? r.ranges.map((g) => ({ law: r.law, from: g.from, to: g.to })) : [{ law: r.law, from: null, to: null }]));
}

// Ordem dos candidatos (e corte, quando passam do limite): vinculante, repercussão geral, repetitivo, súmulas, IAC;
// dentro do tipo, o mais recente primeiro.
const KIND_RANK: Record<PrecedentKind, number> = { sumula_vinculante: 0, repercussao_geral: 1, repetitivo: 2, sumula: 3, iac: 4 };
export function rankCandidates(list: JurisCandidate[]) {
  return [...list].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || (b.decided_on ?? '').localeCompare(a.decided_on ?? '') || b.number - a.number);
}

export interface JurisInput { banca: string; subject: string; title: string; items: JurisCandidate[] }

export function jurisPrompt(p: JurisInput) {
  return `Você conhece as provas de concursos públicos brasileiros${p.banca ? ` e o estilo da banca ${p.banca}` : ''}. Abaixo estão súmulas e teses oficiais do STF e do STJ ligadas aos artigos de lei de um tema de estudo.
Matéria: ${p.subject}
Tema: ${p.title}
Itens (texto oficial):
${p.items.map((c, i) => `${i}. ${precedentLabel(c)}: ${c.text.slice(0, 700)}`).join('\n')}
Regras:
- Escolha até ${MAX_JURIS_PICKS} itens que mais caem em prova para ESTE tema, do mais para o menos cobrado. Item fora do tema fica de fora, mesmo ligado ao artigo.
- como_cai: uma frase curta (até 200 caracteres) com o ponto que a banca explora ou a pegadinha. Use só o que está no texto do item: não acrescente regras, exceções, números, prazos ou outros julgados.
- Na dúvida, deixe de fora: é melhor uma lista curta e certa.`;
}

// Itens escolhidos primeiro (na ordem da IA, com o comentário), depois os demais ligados aos artigos.
export function mergePicks(candidates: JurisCandidate[], picks: JurisPicks | null): JurisItem[] {
  const ranked = rankCandidates(candidates), chosen = new Map<number, string>();
  for (const p of picks?.itens ?? []) if (ranked[p.n] && !chosen.has(p.n) && chosen.size < MAX_JURIS_PICKS) chosen.set(p.n, p.como_cai.trim().slice(0, 240));
  const item = (c: JurisCandidate, how: string, hot: boolean): JurisItem => ({ ...c, label: precedentLabel(c), how, hot });
  return [...[...chosen].map(([n, how]) => item(ranked[n]!, how, true)), ...ranked.filter((_, i) => !chosen.has(i)).map((c) => item(c, '', false))];
}
