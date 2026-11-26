// Montagem da revisão em áudio, em TypeScript puro (roda no navegador; testável no Node). Faz o que o FFmpeg faria:
// equalização leve e compressão da voz, loudness por bloco (ITU-R BS.1770, com gate), pausas reais, trilha em loop com
// crossfade e ducking pela linha do tempo, sinal discreto antes das pausas de recuperação, fades e limitador de pico.
// Processa em janelas, decodificando um bloco de voz por vez: a memória não cresce com a duração.
import { MUSIC_DB, OUTRO_MS, TARGET_LUFS, TRUE_PEAK_DB } from './config.ts';
import type { Timeline } from './script.ts';

export const dbToLin = (db: number) => Math.pow(10, db / 20);
export const linToDb = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

// ---- Biquad (forma direta II transposta) ----
export interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }
export function biquadRun(c: Biquad, x: Float32Array, out = new Float32Array(x.length)) {
  let z1 = 0, z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!, y = c.b0 * v + z1;
    z1 = c.b1 * v - c.a1 * y + z2;
    z2 = c.b2 * v - c.a2 * y;
    out[i] = y;
  }
  return out;
}
export function highpass(f: number, sr: number, q = Math.SQRT1_2): Biquad {
  const w = 2 * Math.PI * f / sr, a = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + a;
  return { b0: (1 + c) / 2 / a0, b1: -(1 + c) / a0, b2: (1 + c) / 2 / a0, a1: -2 * c / a0, a2: (1 - a) / a0 };
}
export function peaking(f: number, sr: number, db: number, q = 1): Biquad {
  const A = Math.pow(10, db / 40), w = 2 * Math.PI * f / sr, a = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + a / A;
  return { b0: (1 + a * A) / a0, b1: -2 * c / a0, b2: (1 - a * A) / a0, a1: -2 * c / a0, a2: (1 - a / A) / a0 };
}

// ---- Loudness (BS.1770-4): filtro K, blocos de 400 ms com 75% de sobreposição, gates absoluto e relativo ----
export function kFilters(sr: number): [Biquad, Biquad] {
  let K = Math.tan(Math.PI * 1681.974450955533 / sr);
  const Vh = Math.pow(10, 3.999843853973347 / 20), Vb = Math.pow(Vh, 0.4996667741545416), Q1 = 0.7071752369554196;
  let a0 = 1 + K / Q1 + K * K;
  const shelf = { b0: (Vh + Vb * K / Q1 + K * K) / a0, b1: 2 * (K * K - Vh) / a0, b2: (Vh - Vb * K / Q1 + K * K) / a0, a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q1 + K * K) / a0 };
  K = Math.tan(Math.PI * 38.13547087602444 / sr);
  const Q2 = 0.5003270373238773;
  a0 = 1 + K / Q2 + K * K;
  return [shelf, { b0: 1, b1: -2, b2: 1, a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q2 + K * K) / a0 }];
}

// Loudness integrada (LUFS) de um ou mais canais.
export function loudness(channels: Float32Array[], sr: number): number {
  const [s, h] = kFilters(sr);
  const sq = channels.map((ch) => { const y = biquadRun(h, biquadRun(s, ch)); for (let i = 0; i < y.length; i++) y[i] = y[i]! * y[i]!; return y; });
  const len = channels[0]?.length ?? 0, block = Math.round(0.4 * sr), hop = Math.round(0.1 * sr);
  if (len < block) {
    const ms = sq.reduce((a, y) => a + y.reduce((p, v) => p + v, 0) / Math.max(1, len), 0);
    return ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity;
  }
  // Somas acumuladas para cada bloco em O(1).
  const acc = new Float64Array(len + 1);
  for (let i = 0; i < len; i++) acc[i + 1] = acc[i]! + sq.reduce((a, y) => a + y[i]!, 0);
  const ms: number[] = [];
  for (let st = 0; st + block <= len; st += hop) ms.push((acc[st + block]! - acc[st]!) / block);
  const lk = (m: number) => -0.691 + 10 * Math.log10(m);
  const abs = ms.filter((m) => m > 0 && lk(m) > -70);
  if (!abs.length) return -Infinity;
  const rel = lk(abs.reduce((a, m) => a + m, 0) / abs.length) - 10;
  const gated = abs.filter((m) => lk(m) > rel);
  return lk(gated.reduce((a, m) => a + m, 0) / gated.length);
}

// ---- Voz: passa-altas, presença leve e compressão suave ----
export function voiceChain(x: Float32Array, sr: number): Float32Array {
  const y = biquadRun(peaking(3500, sr, 1.5, 1), biquadRun(highpass(75, sr), x));
  const T = -24, R = 2.5, att = Math.exp(-1 / (0.01 * sr)), rel = Math.exp(-1 / (0.15 * sr));
  let env = 0;
  for (let i = 0; i < y.length; i++) {
    const p = y[i]! * y[i]!;
    env = p > env ? att * env + (1 - att) * p : rel * env + (1 - rel) * p;
    const lvl = 10 * Math.log10(env + 1e-12);
    if (lvl > T) y[i] = y[i]! * dbToLin(-(lvl - T) * (1 - 1 / R));
  }
  return y;
}

// ---- Trilha em loop com crossfade de potência constante ----
export function musicAt(m: [Float32Array, Float32Array], t: number, cf: number, out: [number, number]) {
  const M = m[0].length, L = M - cf;
  if (L <= 0) { out[0] = m[0][t % M]!; out[1] = m[1][t % M]!; return; }
  const k = Math.floor(t / L), p = t - k * L;
  if (k > 0 && p < cf) {
    const w = p / cf, gi = Math.sin(w * Math.PI / 2), go = Math.cos(w * Math.PI / 2);
    out[0] = m[0][p]! * gi + m[0][p + L]! * go;
    out[1] = m[1][p]! * gi + m[1][p + L]! * go;
  } else { out[0] = m[0][p]!; out[1] = m[1][p]!; }
}

// Nível da trilha (dB relativo à voz) ao longo do tempo: suave na explicação, mais baixa em pergunta, quase sumindo na
// pausa de recuperação, sobe na transição, cheia na abertura e no encerramento; "sem" tira a trilha.
export interface EnvPoint { at: number; db: number }
export function musicEnvelope(tl: Timeline, sr: number): EnvPoint[] {
  const s = (ms: number) => Math.round(ms * sr / 1000);
  const level = (m: 'suave' | 'reduzida' | 'sem') => (m === 'sem' ? -90 : MUSIC_DB[m]);
  const pts: EnvPoint[] = [{ at: 0, db: MUSIC_DB.intro }];
  for (const b of tl.blocks) {
    pts.push({ at: s(b.startMs), db: level(b.music) });
    const pause = b.cue ? MUSIC_DB.pausa : b.transition ? MUSIC_DB.transicao : level(b.music);
    pts.push({ at: s(b.endMs), db: pause });
  }
  const last = tl.blocks[tl.blocks.length - 1];
  if (last) pts.push({ at: s(last.endMs + 300), db: MUSIC_DB.intro });
  return pts;
}

// Sinal de recuperação: dois toques senoidais curtos e baixos (sintetizados, sem licença de terceiros).
export function cueTone(sr: number): Float32Array {
  const n = Math.round(0.7 * sr), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const a = t < 0.35 ? Math.exp(-t * 9) * Math.sin(2 * Math.PI * 880 * t) : 0;
    const b = t >= 0.18 ? Math.exp(-(t - 0.18) * 7) * Math.sin(2 * Math.PI * 1320 * (t - 0.18)) : 0;
    out[i] = (a * 0.6 + b * 0.4) * Math.min(1, t / 0.005);
  }
  return out;
}

// ---- Limitador com lookahead (pico de amostra; teto um pouco abaixo do true peak pedido) ----
export class Limiter {
  private buf: Float32Array[]; private pos = 0; private filled = 0;
  private dq: number[] = []; private dqv: number[] = []; private g = 1; private n = 0;
  private readonly rel: number; private readonly att: number;
  constructor(private channels: number, sr: number, private ceil = dbToLin(TRUE_PEAK_DB - 0.5), private look = Math.round(0.005 * sr)) {
    this.buf = Array.from({ length: channels }, () => new Float32Array(look));
    this.rel = Math.exp(-1 / (0.08 * sr));
    this.att = Math.exp(-1 / (look / 3));
  }
  // Recebe uma amostra por canal; devolve a amostra atrasada (ou null enquanto enche o atraso).
  push(x: number[], out: number[]): boolean {
    let peak = 0;
    for (let c = 0; c < this.channels; c++) peak = Math.max(peak, Math.abs(x[c]!));
    const need = peak > this.ceil ? this.ceil / peak : 1;
    // Mínimo da janela de lookahead (deque monotônico).
    const idx = this.n++;
    while (this.dqv.length && this.dqv[this.dqv.length - 1]! >= need) { this.dq.pop(); this.dqv.pop(); }
    this.dq.push(idx); this.dqv.push(need);
    // A janela inclui a amostra que sai agora (idx - look) e as próximas que já chegaram.
    while (this.dq[0]! < idx - this.look) { this.dq.shift(); this.dqv.shift(); }
    const target = this.dqv[0]!;
    // Ataque em rampa dentro do lookahead (sem degrau); a trava no teto pega o que a rampa não alcançar.
    this.g = target < this.g ? this.att * this.g + (1 - this.att) * target : this.rel * this.g + (1 - this.rel) * target;
    const p = this.pos;
    let ready = false;
    if (this.filled >= this.look) {
      for (let c = 0; c < this.channels; c++) out[c] = Math.max(-this.ceil, Math.min(this.ceil, this.buf[c]![p]! * this.g));
      ready = true;
    } else this.filled++;
    for (let c = 0; c < this.channels; c++) this.buf[c]![p] = x[c]!;
    this.pos = (p + 1) % this.look;
    return ready;
  }
  // Esvazia o atraso no fim.
  flush(emit: (s: number[]) => void) {
    const zero = new Array(this.channels).fill(0), out = new Array(this.channels).fill(0);
    for (let i = 0; i < this.look; i++) if (this.push(zero, out)) emit([...out]);
  }
}

// ---- Montagem completa ----
export interface MixInput {
  timeline: Timeline; sampleRate: number; music: [Float32Array, Float32Array] | null;
  getBlock: (index: number) => Promise<Float32Array>;              // voz decodificada no sampleRate da montagem
  onChunk: (channels: Float32Array[]) => void | Promise<void>;     // pedaços em ordem (1 canal sem trilha, 2 com)
  onProgress?: (fraction: number) => void;
  yieldEvery?: () => Promise<void>;                                 // devolve a vez à tela entre janelas
}
export interface MixReport { lufs: number; peakDb: number; samples: number; expectedSamples: number; silentBlocks: number[]; blockGainsDb: number[] }

const WINDOW_S = 5, MUSIC_CF_S = 2, SILENT_DB = -50;

export async function renderMix(p: MixInput): Promise<MixReport> {
  const sr = p.sampleRate, tl = p.timeline, stereo = !!p.music, chs = stereo ? 2 : 1;
  const toS = (ms: number) => Math.round(ms * sr / 1000);
  const total = toS(tl.totalMs);

  // 1ª passada: ganho de cada bloco para a voz ficar no alvo de loudness (blocos com volumes diferentes se igualam).
  const gains: number[] = [], silent: number[] = [];
  for (const b of tl.blocks) {
    const v = voiceChain(await p.getBlock(b.index), sr);
    const lufs = loudness([v], sr);
    if (!Number.isFinite(lufs) || lufs < SILENT_DB) { silent.push(b.index); gains.push(0); continue; }
    gains.push(dbToLin(Math.max(-20, Math.min(20, TARGET_LUFS - lufs))));
    await p.yieldEvery?.();
  }
  const musicRef = p.music ? dbToLin(TARGET_LUFS - loudness([p.music[0], p.music[1]], sr) - 3) : 0;
  const env = p.music ? musicEnvelope(tl, sr) : [];
  const cue = cueTone(sr), cueGain = dbToLin(-24) * dbToLin(TARGET_LUFS + 14);
  const cueStarts = tl.blocks.filter((b) => b.cue).map((b) => toS(b.endMs + 150));
  const fadeIn = toS(1500), fadeOut = toS(Math.min(OUTRO_MS - 500, 3000));
  const smooth = Math.exp(-1 / (0.25 * sr));

  const bStart = tl.blocks.map((b) => toS(b.startMs)), bEnd = tl.blocks.map((b) => toS(b.endMs));
  const limiter = new Limiter(chs, sr);
  let curIdx = -1, cur: Float32Array | null = null, curStart = 0, curEnd = 0, bi = 0, ei = 0, ci = 0;
  let gDb = MUSIC_DB.intro, peak = 0;
  const outLoud: Float32Array[][] = [];
  const ms: [number, number] = [0, 0], frame = new Array(chs).fill(0), limited = new Array(chs).fill(0);
  let written = 0;

  for (let w0 = 0; w0 < total; w0 += WINDOW_S * sr) {
    const w1 = Math.min(total, w0 + WINDOW_S * sr);
    const out = Array.from({ length: chs }, () => new Float32Array(w1 - w0));
    let o = 0;
    for (let t = w0; t < w1; t++) {
      // Voz: o bloco que cobre t (blocos em ordem, sem sobreposição).
      while (bi < bEnd.length && t >= bEnd[bi]!) bi++;
      let voice = 0;
      const b = tl.blocks[bi];
      if (b && t >= bStart[bi]!) {
        if (curIdx !== b.index) {
          cur = gains[bi] ? voiceChain(await p.getBlock(b.index), sr) : null;
          curIdx = b.index; curStart = bStart[bi]!; curEnd = curStart + (cur?.length ?? 0);
          for (let i = 0; cur && i < cur.length; i++) cur[i] = cur[i]! * gains[bi]!;
        }
        if (cur && t < curEnd) voice = cur[t - curStart]!;
      }
      // Trilha com o nível suavizado (ducking sem cortes).
      // Voz mono nos dois canais soma +3 LU no estéreo (BS.1770): -3 dB por canal mantém o alvo.
      let L = stereo ? voice * Math.SQRT1_2 : voice, R = L;
      if (p.music) {
        while (ei + 1 < env.length && t >= env[ei + 1]!.at) ei++;
        const target = env[ei]!.db;
        gDb = smooth * gDb + (1 - smooth) * target;
        let g = musicRef * dbToLin(gDb);
        if (t < fadeIn) g *= t / fadeIn;
        if (t > total - fadeOut) g *= Math.max(0, (total - t) / fadeOut);
        musicAt(p.music, t, MUSIC_CF_S * sr, ms);
        L += ms[0] * g; R += ms[1] * g;
      }
      // Sinal de recuperação no começo de cada pausa de pergunta.
      while (ci < cueStarts.length && t >= cueStarts[ci]! + cue.length) ci++;
      if (ci < cueStarts.length && t >= cueStarts[ci]!) { const c = cue[t - cueStarts[ci]!]! * cueGain; L += c; R += c; }
      frame[0] = L; if (stereo) frame[1] = R;
      // Saída atrasada pelo limitador (atraso fixo): cabe sempre na janela.
      if (limiter.push(frame, limited)) {
        for (let c = 0; c < chs; c++) { const v = limited[c]!; out[c]![o] = v; if (v > peak) peak = v; else if (-v > peak) peak = -v; }
        o++;
      }
    }
    const chunk = out.map((x) => x.subarray(0, o));
    if (o) { await p.onChunk(chunk); written += o; outLoud.push(chunk.map((x) => x.slice(0, Math.min(x.length, sr * 2)))); }
    p.onProgress?.(w1 / total);
    await p.yieldEvery?.();
  }
  const pending: number[][] = [];
  limiter.flush((s) => pending.push(s));
  if (pending.length) {
    const tail = Array.from({ length: chs }, (_, c) => Float32Array.from(pending.map((s) => s[c]!)));
    for (const ch of tail) for (const v of ch) peak = Math.max(peak, Math.abs(v));
    await p.onChunk(tail);
    written += tail[0]!.length;
  }
  // Loudness final estimada pelas amostras de cada janela (2 s de cada 5): leve e suficiente para conferir.
  const sample = Array.from({ length: chs }, (_, c) => concat(outLoud.map((w) => w[c]!)));
  return { lufs: loudness(sample, sr), peakDb: linToDb(peak), samples: written, expectedSamples: total, silentBlocks: silent, blockGainsDb: gains.map(linToDb) };
}

function concat(parts: Float32Array[]) {
  const out = new Float32Array(parts.reduce((a, x) => a + x.length, 0));
  let at = 0;
  for (const x of parts) { out.set(x, at); at += x.length; }
  return out;
}

// Conferência do resultado (AudioQualityValidator): nada vazio, duração certa, loudness perto do alvo, sem clipping.
export function checkMix(r: MixReport): string[] {
  const issues: string[] = [];
  if (r.silentBlocks.length) issues.push(`blocos sem voz: ${r.silentBlocks.join(', ')}`);
  if (Math.abs(r.samples - r.expectedSamples) > r.expectedSamples * 0.001 + 10) issues.push(`duração diferente da prevista (${r.samples} de ${r.expectedSamples} amostras)`);
  if (!Number.isFinite(r.lufs) || Math.abs(r.lufs - TARGET_LUFS) > 3) issues.push(`loudness fora do alvo (${r.lufs.toFixed(1)} LUFS)`);
  if (r.peakDb > TRUE_PEAK_DB + 0.1) issues.push(`pico acima do teto (${r.peakDb.toFixed(2)} dB)`);
  return issues;
}

