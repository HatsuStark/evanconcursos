// Roteiro da revisão em áudio: formato (schemas validados), conferência sem IA, blocos de narração e linha do tempo.
// O texto narrável fica separado das instruções (pausa, trilha, efeito): só `texto` vai para a voz.
import { z } from 'zod';
import { BLOCK_BREAK_PAUSE_MS, BLOCK_MAX_CHARS, INTRO_MS, OUTRO_MS, PAUSE_RANGE, QUESTION_PAUSE, WORDS_PER_MINUTE } from './config.ts';
import { speakable } from './speak.ts';

export const SEGMENT_TYPES = ['introducao', 'explicacao', 'pergunta', 'resposta', 'feedback', 'exemplo', 'comparacao', 'pegadinha', 'excecao',
  'mnemonico', 'fixacao', 'transicao', 'resumo', 'encerramento'] as const;
export const STAGES = ['preparacao', 'ativacao', 'revisao', 'desafio', 'pegadinhas', 'consolidacao'] as const;
export const QUESTION_FORMATS = ['nenhum', 'certo_errado', 'conceitual', 'enumeracao', 'caso', 'completar', 'diferenciar'] as const;

// ---- Plano pedagógico (etapa B) ----
export const ReviewPlan = z.object({
  titulo: z.string(),
  objetivos: z.array(z.string()),
  capitulos: z.array(z.object({
    id: z.string(),
    titulo: z.string(),
    etapa: z.enum(STAGES),
    temas: z.array(z.string()),          // ids dos temas (T1, T2…)
    objetivo: z.string(),
    conceitos: z.array(z.string()),
    dificuldades: z.array(z.string()),   // só as que os dados mostram
    estrategia: z.string(),
    minutos: z.number(),
    referencias: z.array(z.string()),    // ids dos materiais (M1, M2…)
  })),
});
export type ReviewPlan = z.infer<typeof ReviewPlan>;

// ---- Roteiro (etapa C) ----
export const Segment = z.object({
  id: z.string(),
  tipo: z.enum(SEGMENT_TYPES),
  formato: z.enum(QUESTION_FORMATS),
  texto: z.string(),
  pausa_apos_ms: z.number(),
  interpretacao: z.string(),
  trilha: z.enum(['suave', 'reduzida', 'sem']),
  efeito: z.enum(['nenhum', 'recuperacao', 'transicao']),
  referencias: z.array(z.string()),
});
export type Segment = z.infer<typeof Segment>;
export const ChapterScripts = z.object({ capitulos: z.array(z.object({ id: z.string(), segmentos: z.array(Segment) })) });

export interface Chapter { id: string; titulo: string; etapa: (typeof STAGES)[number]; segmentos: Segment[] }
export interface ReviewScript {
  versao: string; titulo: string; idioma: 'pt-BR'; duracao_alvo_segundos: number; objetivos: string[]; capitulos: Chapter[];
}

// ---- Conferência por IA (etapa D) ----
export const ScriptReview = z.object({
  problemas: z.array(z.object({
    segmento_id: z.string(),
    gravidade: z.enum(['grave', 'leve']),
    motivo: z.string(),
    texto_corrigido: z.string(),          // vazio: tirar o segmento
  })),
});
export type ScriptReview = z.infer<typeof ScriptReview>;

// ---- Miniavaliação ----
export const RetentionQuiz = z.object({
  questoes: z.array(z.object({ enunciado: z.string(), alternativas: z.array(z.string()), correta: z.number(), comentario: z.string(), referencias: z.array(z.string()) })),
});
export type QuizQuestion = z.infer<typeof RetentionQuiz>['questoes'][number];

export const jsonSchemaOf = (s: z.ZodType) => z.toJSONSchema(s, { target: 'draft-7' });

// Capítulos em grupos de até `maxMin` minutos, escritos em paralelo (cada chamada cabe no tempo da Edge Function).
export function chapterGroups(chapters: { id: string; minutos: number }[], maxMin = 8): string[][] {
  const groups: string[][] = [];
  let cur: string[] = [], mins = 0;
  for (const c of chapters) {
    if (cur.length && mins + c.minutos > maxMin) { groups.push(cur); cur = []; mins = 0; }
    cur.push(c.id); mins += c.minutos;
  }
  if (cur.length) groups.push(cur);
  return groups;
}

// ---- Conferência sem IA ----
const CONTENT_TYPES = new Set(['explicacao', 'resposta', 'feedback', 'exemplo', 'comparacao', 'pegadinha', 'excecao', 'mnemonico', 'resumo']);
const ANSWERS = new Set(['resposta', 'feedback']);
const MAX_SEGMENT_CHARS = 900;

// Tira o que a voz leria por engano: marcação, colchetes de direção, emojis.
export function cleanNarration(t: string) {
  return t.replace(/\[[^\]]*\]|\{[^}]*\}|<[^>]*>/g, ' ').replace(/[*_#`|~^]+/g, '').replace(/\((pausa|silêncio|música|som)[^)]*\)/gi, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s+/g, ' ').trim();
}

export function clampPause(s: Pick<Segment, 'tipo' | 'formato' | 'pausa_apos_ms'>) {
  const [lo, hi] = s.tipo === 'pergunta' && s.formato !== 'nenhum' ? QUESTION_PAUSE[s.formato]! : PAUSE_RANGE[s.tipo] ?? [400, 1500];
  const v = Number.isFinite(s.pausa_apos_ms) ? s.pausa_apos_ms : lo;
  return Math.round(Math.min(hi, Math.max(lo, v)));
}

export const words = (t: string) => (t.match(/\S+/g) ?? []).length;
export const speechMs = (t: string) => Math.round((words(t) / WORDS_PER_MINUTE) * 60_000);
export const estimateMs = (s: ReviewScript) =>
  INTRO_MS + OUTRO_MS + s.capitulos.flatMap((c) => c.segmentos).reduce((a, g) => a + speechMs(g.texto) + g.pausa_apos_ms, 0);

export interface CheckResult { script: ReviewScript; issues: string[]; questions: number; estimateMs: number; ok: boolean }

// Normaliza e confere o roteiro. Pergunta sem resposta logo depois sai (o aluno ficaria sem o retorno); referência a
// material inexistente é descartada; pausas ficam dentro das faixas. `ok` falso: não vale gerar áudio.
export function checkScript(input: ReviewScript, sourceIds: Set<string>): CheckResult {
  const issues: string[] = [];
  let n = 0;
  const capitulos = input.capitulos.map((c) => {
    const segs = c.segmentos.map((s) => ({
      ...s, texto: cleanNarration(s.texto).slice(0, MAX_SEGMENT_CHARS), interpretacao: s.interpretacao.slice(0, 120),
      referencias: [...new Set(s.referencias.filter((r) => sourceIds.has(r)))],
    })).filter((s) => s.texto.length > 0);
    const kept: Segment[] = [];
    segs.forEach((s, i) => {
      if (s.tipo === 'pergunta' || s.tipo === 'fixacao') {
        const next = segs.slice(i + 1, i + 3);
        if (!next.some((x) => ANSWERS.has(x.tipo))) { issues.push(`pergunta sem resposta removida: "${s.texto.slice(0, 60)}"`); return; }
      }
      if (CONTENT_TYPES.has(s.tipo) && !s.referencias.length) issues.push(`segmento sem referência: ${s.id}`);
      const retrieval = s.tipo === 'pergunta' || s.tipo === 'fixacao';
      kept.push({
        ...s, id: `s${String(++n).padStart(3, '0')}`,
        formato: retrieval ? (s.formato === 'nenhum' ? 'conceitual' : s.formato) : 'nenhum',
        efeito: retrieval ? 'recuperacao' : s.efeito === 'recuperacao' ? 'nenhum' : s.efeito,
        trilha: retrieval && s.trilha === 'suave' ? 'reduzida' : s.trilha,
        pausa_apos_ms: 0,
      });
      const last = kept[kept.length - 1]!;
      last.pausa_apos_ms = clampPause({ ...last, pausa_apos_ms: s.pausa_apos_ms });
    });
    return { ...c, segmentos: kept };
  }).filter((c) => c.segmentos.length > 0);
  const script = { ...input, capitulos };
  const questions = capitulos.flatMap((c) => c.segmentos).filter((s) => s.efeito === 'recuperacao').length;
  const est = estimateMs(script);
  if (questions < 3) issues.push('menos de 3 perguntas de recuperação');
  if (est < input.duracao_alvo_segundos * 1000 * 0.35) issues.push('roteiro curto demais para a duração pedida');
  return { script, issues, questions, estimateMs: est, ok: questions >= 3 && est >= input.duracao_alvo_segundos * 1000 * 0.35 };
}

// Aplica a conferência da IA: troca o texto dos segmentos com problema; grave sem correção sai. Mais de um terço do
// roteiro com problema grave reprova tudo (null).
export function applyReview(s: ReviewScript, review: ScriptReview): ReviewScript | null {
  const total = s.capitulos.reduce((a, c) => a + c.segmentos.length, 0);
  const grave = review.problemas.filter((p) => p.gravidade === 'grave').length;
  if (total && grave / total > 1 / 3) return null;
  const fix = new Map(review.problemas.map((p) => [p.segmento_id, p]));
  return {
    ...s,
    capitulos: s.capitulos.map((c) => ({
      ...c,
      segmentos: c.segmentos.flatMap((g) => {
        const p = fix.get(g.id);
        if (!p) return [g];
        const t = cleanNarration(p.texto_corrigido);
        if (!t) return p.gravidade === 'grave' ? [] : [g];
        return [{ ...g, texto: t }];
      }),
    })),
  };
}

// ---- Blocos de narração ----
export interface Block { index: number; chapterId: string; segmentIds: string[]; text: string; pauseAfterMs: number; music: 'suave' | 'reduzida' | 'sem'; cue: boolean; transition: boolean }
const QUIETER = { suave: 0, reduzida: 1, sem: 2 } as const;

// Segmentos seguidos viram um bloco (voz mais contínua e menos chamadas) até uma pausa longa, o fim do capítulo ou o
// tamanho máximo. A pausa depois do bloco é silêncio inserido na montagem.
export function buildBlocks(s: ReviewScript): Block[] {
  const out: Block[] = [];
  for (const c of s.capitulos) {
    let cur: Block | null = null;
    const close = () => { if (cur) out.push(cur); cur = null; };
    for (const g of c.segmentos) {
      const text = speakable(g.texto);
      if (!text) continue;
      if (cur && (cur as Block).text.length + text.length + 1 > BLOCK_MAX_CHARS) close();
      if (!cur) cur = { index: out.length, chapterId: c.id, segmentIds: [], text: '', pauseAfterMs: 0, music: 'suave', cue: false, transition: false };
      const b: Block = cur;
      b.segmentIds.push(g.id);
      b.text = b.text ? `${b.text}\n${text}` : text;
      b.pauseAfterMs = g.pausa_apos_ms;
      if (QUIETER[g.trilha] > QUIETER[b.music]) b.music = g.trilha;
      b.cue = g.efeito === 'recuperacao';
      b.transition = g.efeito === 'transicao';
      if (g.pausa_apos_ms >= BLOCK_BREAK_PAUSE_MS || g.efeito !== 'nenhum') close();
    }
    close();
  }
  return out.map((b, i) => ({ ...b, index: i }));
}

// ---- Linha do tempo (a mesma no servidor e na montagem do navegador) ----
export interface TimedBlock { index: number; startMs: number; endMs: number; pauseAfterMs: number; music: Block['music']; cue: boolean; transition: boolean; chapterId: string }
export interface Timeline { blocks: TimedBlock[]; chapters: { id: string; titulo: string; startMs: number }[]; totalMs: number }

export function buildTimeline(blocks: Pick<Block, 'index' | 'chapterId' | 'pauseAfterMs' | 'music' | 'cue' | 'transition'>[], durationsMs: number[], chapters: { id: string; titulo: string }[]): Timeline {
  let at = INTRO_MS;
  const timed: TimedBlock[] = blocks.map((b, i) => {
    const startMs = at, endMs = at + Math.round(durationsMs[i] ?? 0);
    at = endMs + b.pauseAfterMs;
    return { index: b.index, startMs, endMs, pauseAfterMs: b.pauseAfterMs, music: b.music, cue: b.cue, transition: b.transition, chapterId: b.chapterId };
  });
  const last = timed[timed.length - 1];
  const totalMs = (last ? last.endMs : INTRO_MS) + OUTRO_MS;
  const firstOf = new Map<string, number>();
  for (const t of timed) if (!firstOf.has(t.chapterId)) firstOf.set(t.chapterId, t.startMs);
  return {
    blocks: timed, totalMs,
    chapters: chapters.filter((c) => firstOf.has(c.id)).map((c) => ({ id: c.id, titulo: c.titulo, startMs: c === chapters[0] ? 0 : firstOf.get(c.id)! })),
  };
}

// ---- Miniavaliação: limpa e confere ----
const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function cleanQuiz(qs: QuizQuestion[], audioQuestions: string[], sourceIds: Set<string>): QuizQuestion[] {
  const seen = new Set(audioQuestions.map(norm));
  const out: QuizQuestion[] = [];
  for (const q of qs) {
    const alts = q.alternativas.map((a) => a.trim()).filter(Boolean);
    const key = norm(q.enunciado);
    if (!key || seen.has(key) || alts.length !== 4 || new Set(alts.map(norm)).size !== 4 || !(q.correta >= 0 && q.correta < 4) || !q.comentario.trim()) continue;
    seen.add(key);
    out.push({ ...q, enunciado: q.enunciado.trim(), alternativas: alts, correta: Math.trunc(q.correta), referencias: q.referencias.filter((r) => sourceIds.has(r)) });
    if (out.length === 5) break;
  }
  return out.length >= 3 ? out : [];
}
