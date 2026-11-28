// Playlist das revisões em áudio: os capítulos das revisões já geradas viram trechos que tocam em sequência, sem IA nova
// nem nova narração (o MP3 de cada revisão é montado no aparelho, como na revisão da semana). Três jeitos de ouvir:
// - "Para você": fila automática pelos dados do estudante (revisão de teoria vencida, acerto baixo, pouca prática);
//   tema dominado sai. O estudante fixa trechos (sempre entram, primeiro) e tira trechos (nunca entram).
// - Por tema: todos os trechos de um tema, de todas as semanas, do mais recente ao mais antigo.
// - Biblioteca: cada revisão inteira.
// Ouvir não conta como revisão feita nem na meta: só organiza o que já foi gerado.
import type { Timeline } from './script.ts';

export interface Clip {
  key: string;            // `${reviewId}:${chapterId}`
  reviewId: string; chapterId: string; title: string;
  startMs: number; endMs: number;
  themeIds: string[];     // sessões de estudo (temas) do capítulo; vazio = abertura, encerramento ou geral
  createdAt: string;      // da revisão
}
export interface ThemeState { id: string; title: string; subject: string; overdue: boolean; attempts: number; acc: number | null }
export type Mark = 'pin' | 'hide';
export interface QueueItem { clip: Clip; reasons: string[] }

// Acerto de tema dominado (com prática suficiente) e mínimo de questões para o acerto valer.
export const MASTERED_ACC = 0.85, MASTERED_MIN = 5, LOW_ACC = 0.6, MIN_ATTEMPTS = 3;

// Trechos de uma revisão pronta: cada capítulo vai do começo dele ao começo do seguinte (o último, até o fim). Os temas
// vêm do plano da revisão (ids T1, T2… traduzidos para as sessões pelo mapa gravado na coleta). A abertura
// (preparação) cita todos os temas, mas não ensina nenhum: fica sem tema.
export function clipsOf(r: { id: string; createdAt: string; timeline: Timeline; chapters: { id: string; temas: string[]; etapa?: string }[]; themeIds: [string, string][] }): Clip[] {
  const sessionOf = new Map(r.themeIds.map(([session, t]) => [t, session]));
  const temasOf = new Map(r.chapters.map((c) => [c.id, c.etapa === 'preparacao' ? [] : c.temas.map((t) => sessionOf.get(t)).filter((s): s is string => !!s)]));
  const ch = r.timeline.chapters;
  return ch.map((c, i) => ({
    key: `${r.id}:${c.id}`, reviewId: r.id, chapterId: c.id, title: c.titulo,
    startMs: c.startMs, endMs: ch[i + 1]?.startMs ?? r.timeline.totalMs,
    themeIds: [...new Set(temasOf.get(c.id) ?? [])], createdAt: r.createdAt,
  })).filter((c) => c.endMs - c.startMs >= 5000);
}

// Peso de um tema na fila e os motivos (dados reais). null: dominado, fica de fora.
export function themeWeight(t: ThemeState | undefined): { score: number; reasons: string[] } | null {
  if (!t) return { score: 0, reasons: [] };
  const practiced = t.attempts >= MIN_ATTEMPTS && t.acc !== null;
  if (!t.overdue && t.attempts >= MASTERED_MIN && t.acc !== null && t.acc >= MASTERED_ACC) return null;
  let score = 0;
  const reasons: string[] = [];
  if (t.overdue) { score += 3; reasons.push('revisão vencida'); }
  if (practiced && t.acc! < LOW_ACC) { score += 2; reasons.push(`acerto ${Math.round(t.acc! * 100)}%`); }
  else if (practiced && t.acc! < MASTERED_ACC) { score += 1; reasons.push(`acerto ${Math.round(t.acc! * 100)}%`); }
  if (!practiced) { score += 1; reasons.push('pouca prática em questões'); }
  return { score, reasons };
}

// Fila "Para você": fixados primeiro (o mais recente antes), depois os trechos dos temas que mais precisam, até o tempo
// pedido. De cada tema, só a revisão mais recente que o cobre (a anterior fica na biblioteca). Trechos sem tema (abertura,
// encerramento) ficam de fora; tirados nunca entram.
export function smartQueue(clips: Clip[], themes: ThemeState[], marks: Map<string, Mark>, maxMs: number): QueueItem[] {
  const stateOf = new Map(themes.map((t) => [t.id, t]));
  const pinned = clips.filter((c) => marks.get(c.key) === 'pin').sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.startMs - b.startMs);
  const out: QueueItem[] = pinned.map((clip) => ({ clip, reasons: ['fixado'] }));
  const used = new Set(out.map((i) => i.clip.key));
  let total = pinned.reduce((a, c) => a + (c.endMs - c.startMs), 0);

  // Revisão mais recente de cada tema.
  const latest = new Map<string, string>();
  for (const c of [...clips].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) for (const t of c.themeIds) if (!latest.has(t)) latest.set(t, c.reviewId);

  const cands: { clip: Clip; score: number; reasons: string[] }[] = [];
  for (const c of clips) {
    if (used.has(c.key) || marks.get(c.key) === 'hide' || !c.themeIds.length) continue;
    const mine = c.themeIds.filter((t) => latest.get(t) === c.reviewId);
    if (!mine.length) continue;
    const ws = mine.map((t) => themeWeight(stateOf.get(t))).filter((w): w is NonNullable<typeof w> => !!w);
    if (!ws.length) continue; // todos os temas do trecho dominados
    const best = ws.reduce((a, w) => (w.score > a.score ? w : a));
    cands.push({ clip: c, score: best.score, reasons: best.reasons });
  }
  // Mais urgente primeiro; empate: a revisão mais antiga (mais tempo sem ouvir), na ordem dos capítulos.
  cands.sort((a, b) => b.score - a.score || a.clip.createdAt.localeCompare(b.clip.createdAt) || a.clip.reviewId.localeCompare(b.clip.reviewId) || a.clip.startMs - b.clip.startMs);
  for (const c of cands) {
    const len = c.clip.endMs - c.clip.startMs;
    if (out.length && total + len > maxMs) continue;
    out.push({ clip: c.clip, reasons: c.reasons });
    total += len;
  }
  return out;
}

// Trechos de um tema, de todas as revisões: o mais recente primeiro, na ordem dos capítulos.
export const themeClips = (clips: Clip[], themeId: string) =>
  clips.filter((c) => c.themeIds.includes(themeId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.startMs - b.startMs);

// Assinatura da fila, para continuar de onde parou só se ela for a mesma.
export const queueKey = (items: { clip: Clip }[]) => items.map((i) => i.clip.key).join('|');
