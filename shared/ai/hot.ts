// Mais cobrados de um tema, segundo a IA: assuntos e artigos que a banca costuma explorar. Não é medição (a IA pode
// errar): serve para a apostila dar mais espaço a esses pontos e, na sessão com mais artigos do que cabem, escolher quais
// vão para a IA. O candidato é avisado para ler a lei completa. Chamada curta, sem texto de lei (só nomes de seções), e o
// resultado fica em cache compartilhado pelo tema, pelos artigos e pela banca: um estudante paga, os outros reaproveitam.
import { z } from 'zod';

export const HOT_PROMPT_VERSION = 'hot-v1';
export const MAX_HOT_THEMES = 8, MAX_HOT_ARTICLES = 15;

export const HotTopics = z.object({
  temas: z.array(z.string()).describe('Assuntos do tema mais cobrados pela banca, do mais para o menos cobrado.'),
  artigos: z.array(z.string()).describe('Artigos mais cobrados, só dos intervalos fornecidos, no formato "CPC, art. 238".'),
});
export type HotTopics = z.infer<typeof HotTopics>;
export const hotJsonSchema = () => z.toJSONSchema(HotTopics, { target: 'draft-7' });

export interface HotLaw { ref: string; short: string; sections: { name: string; from: string; to: string }[] }
export interface HotInput { banca: string; subject: string; title: string; topics: string[]; laws: HotLaw[] }

export function hotPrompt(p: HotInput) {
  return `Você conhece as provas de concursos públicos brasileiros. Liste o que a banca ${p.banca || 'de concursos'} mais cobra no tema abaixo, pelas provas que você conhece.
Matéria: ${p.subject}
Tema: ${p.title}
Item do edital (contexto): ${p.topics.join(' | ') || '—'}
${p.laws.length ? `Leis e artigos do tema (só nomes das seções):\n${p.laws.map((l) => `${l.ref}\n${l.sections.map((s) => `- ${s.name} (arts. ${s.from} a ${s.to})`).join('\n')}`).join('\n')}` : 'Tema sem artigos de lei.'}
Regras:
- temas: até ${MAX_HOT_THEMES} assuntos do tema, curtos (ex.: "Citação por edital", "Nulidade relativa x absoluta"), do mais para o menos cobrado.
- artigos: até ${MAX_HOT_ARTICLES}, só dentro dos intervalos acima, no formato "${p.laws[0]?.short ?? 'Lei'}, art. N". Vazio se o tema não tem artigos.
- Na dúvida, deixe de fora: é melhor uma lista curta e certa. Não invente artigos fora dos intervalos.`;
}

// Rótulos "lei:artigo" dos artigos devolvidos, só os que existem entre os fornecidos ("CPC, art. 238" → "lei-13105-2015:238").
export function hotArticleKeys(r: HotTopics, articles: { lawKey: string; label: string }[], shortOf: (lawKey: string) => string) {
  // Sem acento, espaço nem pontuação: "CPC, art. 1.015", "CPC art 1015" e "CPC, artigo 1.015º" viram "cpcart1015".
  const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/artigo/g, 'art').replace(/[^a-z0-9-]/g, '');
  const known = new Map(articles.map((a) => [norm(`${shortOf(a.lawKey)} art ${a.label}`), `${a.lawKey}:${a.label}`]));
  return [...new Set(r.artigos.map((x) => known.get(norm(x))).filter((k): k is string => !!k))];
}

// Trechos da apostila: os temas mais cobrados, para dar mais espaço e prioridade alta, sem deixar o resto do tema de fora.
// O aviso de que é estimativa fica na tela ("O que mais cai"), não no texto da apostila.
export const hotGuideNote = (h: HotTopics | null) => (h?.temas.length || h?.artigos.length
  ? `Mais cobrados pela banca, segundo levantamento da IA (estimativa, pode falhar): ${[...h.temas, ...h.artigos].slice(0, MAX_HOT_THEMES + MAX_HOT_ARTICLES).join('; ')}. Cubra o tema inteiro, mas dê prioridade alta e mais espaço a esses pontos, e destaque-os em pontos_banca. Não comente na apostila que esses destaques são estimativa.`
  : '');

// Apostilas gravadas antes: a introdução traz uma frase dizendo que os destaques são estimativa e mandando ler a lei seca.
export const dropHotDisclaimer = (t: string) => t
  .replace(/[^.!?\n]*\bestimativa[^.!?\n]*\blei seca[^.!?\n]*[.!?]?/gi, '')
  .replace(/[^.!?\n]*\blei seca[^.!?\n]*\bestimativa[^.!?\n]*[.!?]?/gi, '')
  .trim();
