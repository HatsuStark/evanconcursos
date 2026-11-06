// Leitura do conteúdo programático por linhas: a IA aponta, o código copia.
// O texto do PDF (extraído sem IA) vai numerado por linha; a IA devolve só em que linhas começa cada tópico de cada
// disciplina e onde a disciplina termina. O texto dos tópicos é recortado do próprio PDF. Assim não há cópia pela IA:
// sem filtro RECITATION, sem resposta longa que estoura o tempo, sem item grande demais e sem tópico inventado. E dá para
// medir a cobertura: linhas do conteúdo programático que não entraram em nenhuma disciplina.
// Os dados gerais (blocos, questões, datas, atribuições) seguem numa chamada com o PDF (parte 'meta'), em paralelo.
import { z } from 'zod';
import { GeminiError, generateJson, type GeminiUsage } from './gemini.ts';
import {
  comparableText, extractWithRetry, fillMissingTopics, fillTopicGaps, NOTICE_THINKING, NoticeExtraction, noticeJsonSchema, noticePrompt, normalizeText, roleRules,
  type NoticeSpecific,
} from './notice.ts';

export interface PdfLine { n: number; page: number; text: string }

// Começo de item do conteúdo programático: "1.", "1.2", "3 ", "a)", "IV –", marcador.
const ITEM = /^(?:\d{1,3}(?:\.\d{1,3})*\.?|[a-z]{1,2}\)|[IVXL]{1,6}\s*[–-]|[•▪●-])\s+\S/;
// Dentro de um parágrafo corrido, um item novo começa depois de pontuação: "…constitucional. 2 Sistemas…".
const INNER_ITEM = /(?<=[.;:])\s+(?=(?:\d{1,3}(?:\.\d{1,3})*\.?|[a-z]\))\s+[A-ZÀ-Ú])/; // item começa com maiúscula: "(arts. 13 a 25)" não é item
const isTitle = (l: string) => l.length <= 120 && l === l.toUpperCase() && /[A-ZÀ-Ú]{3}/.test(l);

// Trechos numerados do texto do PDF, cada um mais ou menos um item do edital: sem cabeçalho e rodapé (linha repetida em
// boa parte das páginas) nem número de página; linha que só continua a anterior é emendada, e parágrafo corrido com
// vários itens é dividido antes de cada numeração. Linha física não serve: no TJCE (Cebraspe, parágrafo corrido) os
// itens atravessam as quebras de linha e o recorte saía no meio da frase.
export function numberLines(pages: string[]): PdfLine[] {
  const perPage = pages.map((p) => p.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean));
  const seen = new Map<string, number>();
  for (const lines of perPage) for (const k of new Set(lines.map((l) => normalizeText(l)))) seen.set(k, (seen.get(k) ?? 0) + 1);
  const repeated = (l: string) => pages.length >= 4 && (seen.get(normalizeText(l)) ?? 0) >= Math.max(3, pages.length * 0.3);
  const merged: { page: number; text: string }[] = [];
  perPage.forEach((lines, i) => {
    for (const text of lines) {
      if (/^\d{1,3}$/.test(text) || repeated(text)) continue;
      const prev = merged.at(-1);
      const continues = prev && !ITEM.test(text) && !isTitle(text) && !isTitle(prev.text) && (!/[.;:]$/.test(prev.text) || prev.text.endsWith('-'));
      // Hífen no fim da linha fica ("político-administrativa"): palavra composta é mais comum no edital que sílaba partida.
      if (continues) prev.text = prev.text.endsWith('-') ? prev.text + text : `${prev.text} ${text}`;
      else merged.push({ page: i + 1, text });
    }
  });
  const out: PdfLine[] = [];
  for (const m of merged) for (const part of m.text.split(INNER_ITEM)) if (part.trim()) out.push({ n: out.length + 1, page: m.page, text: part.trim() });
  return out;
}

export const LinePointers = z.object({
  subjects: z.array(z.object({
    name: z.string().trim().min(1).max(120).describe('Nome da disciplina como no edital, sem numeração.'),
    starts: z.array(z.number().int().min(1)).describe('Números das linhas (L) onde começa cada tópico da disciplina, em ordem crescente.'),
    end: z.number().int().min(1).describe('Número da última linha do conteúdo da disciplina.'),
  })),
});
export type LinePointers = z.infer<typeof LinePointers>;
export const linePointersJsonSchema = () => z.toJSONSchema(LinePointers, { target: 'draft-7' });

export function linesPrompt(roleHint: string, exact?: { code?: string; otherRoles?: string[] }): string {
  const { cargo, scope } = roleRules(roleHint, exact, 'lines');
  return `Você é especialista em editais de concursos públicos brasileiros. Abaixo está o texto do edital, com cada linha numerada (L1, L2, ...). Encontre o conteúdo programático do cargo e indique, para cada disciplina, as linhas onde começam os seus tópicos.
Cargo: ${cargo}.
Regras:
${scope}
- subjects: uma entrada por disciplina do conteúdo programático do cargo, na ordem do edital, com o nome como no edital. Quando um bloco agrupa várias disciplinas com títulos próprios (inclusive em MAIÚSCULAS), cada uma é uma entrada; nunca use o nome do bloco como disciplina quando ele tem títulos internos.
- starts: as linhas onde começa cada tópico de estudo. Um tópico é um assunto que se estuda de uma vez: um tema com os seus desdobramentos, ou uma lei com os artigos citados. Subitens que só detalham o mesmo tema (1.1, 1.2) ficam no tópico do item principal; temas diferentes começam tópicos diferentes, mesmo quando aparecem como subitens de uma lista. Cada lei, código ou capítulo citado com os seus artigos é um tópico próprio (ex.: em "a) Dos crimes contra a pessoa (arts. 121 a 154-B). b) Dos crimes contra o patrimônio (arts. 155 a 183).", cada letra é um tópico). Em geral um tópico ocupa de uma a seis linhas; mais de oito linhas costuma juntar temas diferentes. Nunca a disciplina inteira num tópico. Não inclua a linha do título da disciplina.
- end: a última linha do conteúdo da disciplina, antes do título da disciplina seguinte, de outro anexo ou de observações finais.
- O texto vem da extração do PDF: títulos de seção às vezes aparecem fora de lugar (no fim da página). Guie-se pelo conteúdo dos itens, não pela posição dos títulos.
- Use só números de linha que existem no texto. Não invente disciplinas: só as que têm conteúdo programático para este cargo.`;
}

const MAX_TOPIC = 2000;
// Junta os trechos de um tópico (hífen no fim fica, como em numberLines).
const joinLines = (ls: string[]) => ls.reduce((acc, l) => (acc.endsWith('-') ? acc + l : acc ? `${acc} ${l}` : l), '');

// Disciplinas: as da leitura geral, com os tópicos achados nas linhas. Disciplina "guarda-chuva" da leitura geral (sem
// tópicos, ex.: "Conhecimentos em Direito" no Escrevente do TJSP) dá lugar às disciplinas que as linhas acharam e a
// leitura geral não listou, no mesmo bloco.
export function adoptLineSubjects(meta: NoticeExtraction, spec: NoticeSpecific): NoticeExtraction {
  const key = (s: string) => comparableText(s) || normalizeText(s);
  const same = (a: string, b: string) => !!a && !!b && (a === b || a.includes(b) || b.includes(a));
  const filled = fillMissingTopics({ ...meta, subjects: meta.subjects.map((s) => ({ ...s, topics: [] })) }, spec);
  const unmatched = spec.subjects.filter((x) => x.topics.length && !meta.subjects.some((s) => same(key(s.name), key(x.name))));
  const umbrella = filled.subjects.findIndex((s) => !s.topics.length);
  if (unmatched.length < 2 || umbrella < 0) return filled;
  const u = filled.subjects[umbrella]!;
  // Nome de bloco da prova ("BLOCO II: Conhecimentos em Direito"): as disciplinas das linhas entram no lugar dela.
  // Disciplina de verdade com seções internas ("Noções Gerais de Direito e Formação Humanística" do Juiz, com Sociologia,
  // Filosofia…): as seções viram tópicos dela, com o nome da seção à frente.
  const isBlock = meta.blocks.some((b) => same(key(b.name), key(u.name)) || key(b.name).endsWith(key(u.name)));
  const subjects = isBlock
    ? unmatched.map((x) => ({ name: x.name, block: u.block || u.name, questions: 0, core: u.core, topics: x.topics }))
    : [{ ...u, topics: unmatched.flatMap((x) => x.topics.map((t, i) => (i ? t : { ...t, text: `${x.name}: ${t.text}`.slice(0, 2000) }))) }];
  return { ...filled, subjects: [...filled.subjects.slice(0, umbrella), ...subjects, ...filled.subjects.slice(umbrella + 1)] };
}
// Tópico acima do limite é dividido nos pontos finais, sem perder texto.
function splitLong(text: string): string[] {
  if (text.length <= MAX_TOPIC) return [text];
  const out: string[] = [];
  let cur = '';
  for (const s of text.split(/(?<=[.;])\s+/)) {
    if (cur && (cur + ' ' + s).length > MAX_TOPIC) { out.push(cur); cur = s; } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out.flatMap((t) => (t.length > MAX_TOPIC ? t.match(new RegExp(`.{1,${MAX_TOPIC}}`, 'g')) ?? [] : [t]));
}

// Cada lei ou capítulo citado com artigos é um tópico, mesmo que a IA junte a lista inteira ("a) Dos crimes contra a pessoa
// (arts. 121 a 154-B). b) Dos crimes contra o patrimônio…"): com três ou mais trechos assim, cada um abre um tópico, e o que
// vem entre eles fica no anterior. A IA variava entre rodadas (Parte Especial do Código Penal num tópico só ou dividida).
const LAW_ITEM = /\barts?\.\s*\d|\bLei\s+(?:Complementar\s+)?(?:n[º°o.]?\s*)?\d|\bDecreto(?:-lei)?\s+(?:n[º°o.]?\s*)?\d/i;
function lawGroups(ls: PdfLine[]): PdfLine[][] {
  if (ls.filter((l) => LAW_ITEM.test(l.text)).length < 3) return [ls];
  const groups: PdfLine[][] = [];
  for (const l of ls) if (!groups.length || LAW_ITEM.test(l.text)) groups.push([l]); else groups.at(-1)!.push(l);
  return groups;
}

// Título solto dentro do trecho (nome de disciplina, "ANEXO I", "CONTEÚDO PROGRAMÁTICO"): não é conteúdo.
const isHeading = (text: string, names: Set<string>) => {
  const k = normalizeText(text);
  return names.has(k) || /^anexo [ivxl]+\b/.test(k) || /^(do )?conteudo programatico$/.test(k);
};

// Tópicos recortados do texto pelas linhas apontadas, e as linhas do trecho que não entraram em nenhuma disciplina.
export function topicsFromLines(lines: PdfLine[], ptr: LinePointers): { spec: NoticeSpecific; uncovered: PdfLine[] } {
  const byN = new Map(lines.map((l) => [l.n, l]));
  const names = new Set(ptr.subjects.map((s) => normalizeText(s.name)));
  const ranges: [number, number][] = [];
  const subjects = ptr.subjects.map((s) => {
    const starts = [...new Set(s.starts)].filter((n) => byN.has(n) && n <= s.end).sort((a, b) => a - b);
    if (!starts.length) return { name: s.name, topics: [] };
    ranges.push([starts[0]!, s.end]);
    const topics = starts.flatMap((start, i) => {
      const stop = i + 1 < starts.length ? starts[i + 1]! - 1 : s.end;
      const ls: PdfLine[] = [];
      for (let n = start; n <= stop; n++) { const l = byN.get(n); if (l && !isHeading(l.text, names)) ls.push(l); }
      return lawGroups(ls).flatMap((g) => {
        const text = joinLines(g.map((l) => l.text)).trim();
        return text ? splitLong(text).map((t) => ({ text: t, page: g[0]!.page })) : [];
      });
    });
    return { name: s.name, topics };
  });
  // Cobertura: dentro do trecho do conteúdo programático (da 1ª à última linha apontada), linhas fora de toda disciplina.
  const lo = Math.min(...ranges.map((r) => r[0])), hi = Math.max(...ranges.map((r) => r[1]));
  const uncovered = ranges.length ? lines.filter((l) => l.n >= lo && l.n <= hi && !ranges.some(([a, b]) => l.n >= a && l.n <= b) && !isHeading(l.text, names)) : [];
  return { spec: { subjects }, uncovered };
}

// Texto suficiente para a leitura por linhas; abaixo disso (PDF escaneado), a leitura com o PDF.
export const hasLineText = (pages: string[]) => pages.join('').replace(/\s+/g, '').length >= 2000;

export async function readNoticeByLines(o: { apiKey: string; model: string; pdfBase64: string; pages: string[]; roleHint: string; exact?: { code?: string; otherRoles?: string[] }; fetchImpl?: typeof fetch }) {
  const lines = numberLines(o.pages);
  return extractWithRetry(async ({ temperature, retry, timeoutMs }) => {
    const started = Date.now();
    const parts = (t: string) => [{ inline_data: { mime_type: 'application/pdf', data: o.pdfBase64 } }, { text: t }];
    const common = { apiKey: o.apiKey, model: o.model, temperature, timeoutMs, thinkingLevel: NOTICE_THINKING, fetchImpl: o.fetchImpl };
    const numbered = lines.map((l) => `L${l.n}| ${l.text}`).join('\n');
    const zero: GeminiUsage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };
    const [a, b] = await Promise.all([
      generateJson({ ...common, schema: NoticeExtraction, jsonSchema: noticeJsonSchema(), parts: parts(noticePrompt(o.roleHint, retry, o.exact, 'meta')) }),
      generateJson({ ...common, temperature: 0, schema: LinePointers, jsonSchema: linePointersJsonSchema(), parts: [{ text: `${linesPrompt(o.roleHint, o.exact)}\n\nTEXTO DO EDITAL:\n${numbered}` }] })
        .catch((err: unknown) => ({ data: { subjects: [] } as LinePointers, raw: { error: err instanceof Error ? err.message : String(err) }, usage: err instanceof GeminiError && err.usage ? err.usage : zero })),
    ]);
    const usage: GeminiUsage = { inputTokens: a.usage.inputTokens + b.usage.inputTokens, outputTokens: a.usage.outputTokens + b.usage.outputTokens, thinkingTokens: a.usage.thinkingTokens + b.usage.thinkingTokens };
    const add = (u: GeminiUsage) => { usage.inputTokens += u.inputTokens; usage.outputTokens += u.outputTokens; usage.thinkingTokens += u.thinkingTokens; };
    const { spec, uncovered } = topicsFromLines(lines, b.data);
    const viaLines = adoptLineSubjects(a.data, spec);
    const raw: Record<string, unknown> = { main: a.raw, lines: b.raw, uncovered: uncovered.slice(0, 200).map((l) => ({ n: l.n, page: l.page, text: l.text })) };
    // O que as linhas não cobriram vai para a passada extra com o PDF, como na leitura anterior.
    const data = await fillTopicGaps(viaLines, { ...o, common, parts, retry, temperature, deadline: started + timeoutMs, add, raw });
    return { data, raw, usage, model: a.model, latencyMs: Date.now() - started, uncovered };
  });
}
