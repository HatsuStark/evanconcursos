// Revisão em áudio no app: chamadas à função audio-review e montagem do MP3 no aparelho (pausas, trilha, loudness)
// a partir da narração em blocos. O MP3 montado fica no Cache Storage do navegador: abrir de novo não remonta.
import { useQuery } from '@tanstack/react-query';
import type { Timeline } from '../../../shared/audio/script.ts';
import { supabase } from './supabase.ts';

export const MUSIC_URL = '/audio/lofi-01.mp3';
const RATE = 24000, CACHE = 'audio-reviews-v1';

export type AudioStatus = 'queued' | 'planning' | 'scripting' | 'validating' | 'narrating' | 'ready' | 'failed';
export interface AudioReview {
  id: string; status: AudioStatus; duration: number; voice: 'feminina' | 'masculina'; error: string | null; title: string | null;
  themes: { id: string; title: string; subject: string; bucket: string; minutes: number; reasons: string[] }[]; errors: number;
  timeline: Timeline | null; durationMs: number | null; objectives: string[];
  quiz: { enunciado: string; alternativas: string[] }[] | null; quizStatus: string; quizResult: { score: number; answers: number[] } | null;
  positionMs: number; maxPositionMs: number; completed: boolean; music: boolean | null; speed: number | null;
  blocks?: { done: number; total: number } | null;
}
export interface QuizResult { score: number; total: number; correct: number[]; comments: string[]; answers: number[] }

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('audio-review', { body });
  if (error) {
    let msg = error.message;
    try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* sem JSON */ }
    throw new Error(msg);
  }
  return data as T;
}

const WORKING = new Set<AudioStatus>(['queued', 'planning', 'scripting', 'validating', 'narrating']);
export const isWorking = (s?: AudioStatus) => !!s && WORKING.has(s);

// Etapa atual, sem porcentagem inventada: a narração mostra blocos prontos de quantos (dado real).
export function stageLabel(r: AudioReview): string {
  switch (r.status) {
    case 'queued': return 'Preparando conteúdos';
    case 'planning': return 'Planejando a revisão';
    case 'scripting': return 'Escrevendo o roteiro';
    case 'validating': return 'Conferindo o conteúdo';
    case 'narrating': return r.blocks?.total ? `Produzindo a narração (${r.blocks.done} de ${r.blocks.total} trechos)` : 'Produzindo a narração';
    case 'ready': return 'Pronta';
    default: return 'A geração não terminou';
  }
}

// A trilha só existe depois de aprovada (arquivo em web/public/audio): sem ela, a opção nem aparece.
export function useMusicAvailable() {
  return useQuery({
    queryKey: ['audio-music'], staleTime: Infinity,
    queryFn: () => fetch(MUSIC_URL, { method: 'HEAD' }).then((r) => r.ok && (r.headers.get('content-type') ?? '').startsWith('audio')).catch(() => false),
  });
}

export function useAudioReview(taskId: string) {
  return useQuery({
    queryKey: ['audio-review', taskId],
    queryFn: () => invoke<{ review: AudioReview | null; used: number; limit: number; available: boolean; early: boolean; date: string | null }>({ action: 'status', taskId }),
    refetchInterval: (q) => (isWorking(q.state.data?.review?.status) ? 4000 : false),
    refetchOnWindowFocus: true,
  });
}

export const startAudioReview = (taskId: string, duration: number, voice: string) => invoke<{ review: AudioReview }>({ action: 'start', taskId, duration, voice });
export const retryAudioReview = (id: string) => invoke<{ review: AudioReview }>({ action: 'retry', id });
export const answerAudioQuiz = (id: string, answers: number[]) => invoke<QuizResult>({ action: 'quiz', id, answers });
export const saveAudioProgress = (id: string, p: { positionMs: number; listenedMs: number; music?: boolean; speed?: number; completed?: boolean }) =>
  invoke<{ ok: true }>({ action: 'progress', id, ...p }).catch(() => { /* a escuta continua sem rede */ });

// ---- Montagem no aparelho ----
async function decode(buf: ArrayBuffer, channels: number) {
  const ctx = new OfflineAudioContext(channels, RATE, RATE);
  return ctx.decodeAudioData(buf);
}

let musicCache: Promise<[Float32Array, Float32Array] | null> | null = null;
export function loadMusic() {
  musicCache ??= fetch(MUSIC_URL).then(async (r) => {
    if (!r.ok) return null;
    const a = await decode(await r.arrayBuffer(), 2);
    return [a.getChannelData(0).slice(), a.getChannelData(a.numberOfChannels > 1 ? 1 : 0).slice()] as [Float32Array, Float32Array];
  }).catch(() => null);
  return musicCache;
}

const cacheKey = (id: string, music: boolean) => `/audio-review/${id}/${music ? 'trilha' : 'voz'}.mp3`;
async function fromCache(id: string, music: boolean): Promise<Blob | null> {
  try { const r = await (await caches.open(CACHE)).match(cacheKey(id, music)); return r ? await r.blob() : null; } catch { return null; }
}
async function toCache(id: string, music: boolean, blob: Blob) {
  try { await (await caches.open(CACHE)).put(cacheKey(id, music), new Response(blob, { headers: { 'Content-Type': 'audio/mpeg' } })); } catch { /* sem Cache Storage */ }
}

// Monta (ou pega do cache) a versão pedida. Sem a trilha disponível, sai a versão só com voz.
export async function buildAudio(r: AudioReview, music: boolean, onProgress: (f: number) => void): Promise<{ blob: Blob; music: boolean; issues: string[] }> {
  const track = music ? await loadMusic() : null;
  const withMusic = !!track;
  const cached = await fromCache(r.id, withMusic);
  if (cached) return { blob: cached, music: withMusic, issues: [] };
  const { blocks } = await invoke<{ blocks: { index: number; url: string }[] }>({ action: 'links', id: r.id });
  const urlOf = new Map(blocks.map((b) => [b.index, b.url]));
  // Os blocos são baixados uma vez e decodificados quando a montagem precisa (memória baixa).
  const raw = new Map<number, Promise<ArrayBuffer>>();
  const fetchBlock = (i: number) => {
    if (!raw.has(i)) raw.set(i, fetch(urlOf.get(i)!).then((x) => { if (!x.ok) throw new Error('Falha ao baixar a narração.'); return x.arrayBuffer(); }));
    return raw.get(i)!;
  };
  // Encoder e montagem só carregam quando há áudio para montar (fora do pacote da tela de estudo). O .wasm vem como
  // arquivo do próprio site: o padrão da biblioteca busca uma URL data:, que o CSP (connect-src) bloqueia.
  const [{ createEncoder }, { default: mp3Wasm }, { checkMix, renderMix }] = await Promise.all([
    import('wasm-media-encoders'), import('wasm-media-encoders/wasm/mp3?url'), import('../../../shared/audio/mix.ts'),
  ]);
  const enc = await createEncoder('audio/mpeg', mp3Wasm);
  enc.configure({ sampleRate: RATE, channels: withMusic ? 2 : 1, bitrate: withMusic ? 128 : 64 });
  const parts: Uint8Array[] = [];
  const report = await renderMix({
    timeline: r.timeline!, sampleRate: RATE, music: track,
    getBlock: async (i) => {
      void fetchBlock(i + 1).catch(() => {}); // já baixa o próximo
      return (await decode((await fetchBlock(i)).slice(0), 1)).getChannelData(0).slice();
    },
    onChunk: (c) => { parts.push(enc.encode(c).slice()); },
    onProgress,
    yieldEvery: () => new Promise((res) => setTimeout(res, 0)),
  });
  parts.push(enc.finalize().slice());
  const blob = new Blob(parts as BlobPart[], { type: 'audio/mpeg' });
  const issues = checkMix(report);
  if (!issues.some((i) => i.startsWith('blocos sem voz') || i.startsWith('duração'))) await toCache(r.id, withMusic, blob);
  return { blob, music: withMusic, issues };
}

export const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
