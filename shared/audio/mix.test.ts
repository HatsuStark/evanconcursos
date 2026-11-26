import { describe, expect, it } from 'vitest';
import { INTRO_MS, OUTRO_MS, TARGET_LUFS } from './config.ts';
import { checkMix, Limiter, loudness, musicAt, musicEnvelope, renderMix } from './mix.ts';
import { buildTimeline } from './script.ts';

const sine = (f: number, amp: number, sec: number, sr: number) => Float32Array.from({ length: Math.round(sec * sr) }, (_, i) => amp * Math.sin(2 * Math.PI * f * i / sr));
// "Fala" sintética: tom modulado em sílabas, com volume próprio.
const speechLike = (sec: number, amp: number, sr: number) => Float32Array.from({ length: Math.round(sec * sr) }, (_, i) => {
  const t = i / sr;
  return amp * Math.max(0, Math.sin(2 * Math.PI * 4 * t)) * (Math.sin(2 * Math.PI * 220 * t) + 0.5 * Math.sin(2 * Math.PI * 1100 * t));
});

describe('loudness BS.1770', () => {
  it('seno de 997 Hz a -20 dBFS de pico mede cerca de -23 LUFS', () => {
    expect(loudness([sine(997, 0.1, 3, 48000)], 48000)).toBeCloseTo(-23.0, 0);
    expect(Math.abs(loudness([sine(997, 0.1, 3, 24000)], 24000) + 23)).toBeLessThan(0.6);
  });
  it('silêncio é -Infinity', () => {
    expect(loudness([new Float32Array(48000)], 48000)).toBe(-Infinity);
  });
});

describe('trilha', () => {
  it('loop com crossfade sem salto na emenda', () => {
    const sr = 1000, m: [Float32Array, Float32Array] = [Float32Array.from({ length: 5000 }, (_, i) => Math.sin(i / 50)), Float32Array.from({ length: 5000 }, (_, i) => Math.sin(i / 50))];
    const o: [number, number] = [0, 0];
    let prev = 0, maxJump = 0;
    for (let t = 0; t < 12000; t++) { musicAt(m, t, 1000, o); if (t) maxJump = Math.max(maxJump, Math.abs(o[0] - prev)); prev = o[0]; }
    expect(maxJump).toBeLessThan(0.1);
  });
  it('envelope: pergunta baixa, pausa de recuperação mais baixa, transição sobe', () => {
    const tl = buildTimeline([
      { index: 0, chapterId: 'C1', pauseAfterMs: 8000, music: 'reduzida', cue: true, transition: false },
      { index: 1, chapterId: 'C1', pauseAfterMs: 1500, music: 'suave', cue: false, transition: true },
    ], [2000, 2000], [{ id: 'C1', titulo: 'A' }]);
    const e = musicEnvelope(tl, 1000).map((p) => p.db);
    expect(e).toEqual([-14, -30, -36, -24, -18, -14]);
  });
});

describe('limitador', () => {
  it('nenhuma amostra passa do teto', () => {
    const l = new Limiter(1, 24000);
    const out = [0];
    let peak = 0;
    for (let i = 0; i < 24000; i++) if (l.push([1.5 * Math.sin(i / 7)], out)) peak = Math.max(peak, Math.abs(out[0]!));
    expect(20 * Math.log10(peak)).toBeLessThanOrEqual(-1.4);
  });
});

describe('montagem', () => {
  const sr = 8000;
  const blocks = [
    { index: 0, chapterId: 'C1', pauseAfterMs: 6000, music: 'reduzida' as const, cue: true, transition: false },
    { index: 1, chapterId: 'C2', pauseAfterMs: 1000, music: 'suave' as const, cue: false, transition: false },
  ];
  const voice = [speechLike(4, 0.05, sr), speechLike(3, 0.6, sr)];
  const tl = buildTimeline(blocks, voice.map((v) => (v.length / sr) * 1000), [{ id: 'C1', titulo: 'Um' }, { id: 'C2', titulo: 'Dois' }]);

  it('com trilha: estéreo, duração exata, voz no alvo, sem clipping', async () => {
    const music: [Float32Array, Float32Array] = [sine(330, 0.3, 6, sr), sine(440, 0.3, 6, sr)];
    const chunks: Float32Array[][] = [];
    const r = await renderMix({ timeline: tl, sampleRate: sr, music, getBlock: async (i) => voice[i]!.slice(), onChunk: (c) => { chunks.push(c.map((x) => x.slice())); } });
    expect(chunks[0]!.length).toBe(2);
    expect(r.samples).toBe(Math.round(tl.totalMs * sr / 1000));
    expect(checkMix(r)).toEqual([]);
    // Os dois blocos, com volumes muito diferentes, recebem ganhos diferentes (o compressor já aproxima parte).
    expect(Math.abs(r.blockGainsDb[0]! - r.blockGainsDb[1]!)).toBeGreaterThan(8);
    // A trilha toca na abertura (antes da primeira fala).
    const intro = chunks[0]![0]!.subarray(0, Math.round((INTRO_MS - 500) * sr / 1000));
    expect(Math.max(...intro.map(Math.abs))).toBeGreaterThan(0.01);
  });

  it('sem trilha: mono, mesma duração (a troca mantém a posição)', async () => {
    const chunks: Float32Array[][] = [];
    const r = await renderMix({ timeline: tl, sampleRate: sr, music: null, getBlock: async (i) => voice[i]!.slice(), onChunk: (c) => { chunks.push(c); } });
    expect(chunks[0]!.length).toBe(1);
    expect(r.samples).toBe(Math.round(tl.totalMs * sr / 1000));
    expect(Math.abs(r.lufs - TARGET_LUFS)).toBeLessThan(6);
    expect(r.peakDb).toBeLessThanOrEqual(-1);
  });

  it('bloco sem voz é apontado', async () => {
    const r = await renderMix({ timeline: tl, sampleRate: sr, music: null, getBlock: async (i) => (i === 0 ? new Float32Array(voice[0]!.length) : voice[1]!.slice()), onChunk: () => {} });
    expect(r.silentBlocks).toEqual([0]);
    expect(checkMix(r)[0]).toContain('blocos sem voz');
  });

  it('desempenho: 20 min a 24 kHz em tempo razoável (estimado por 60 s)', async () => {
    const sr2 = 24000, sec = 60;
    const v = speechLike(25, 0.2, sr2);
    const t2 = buildTimeline([{ index: 0, chapterId: 'C1', pauseAfterMs: 8000, music: 'suave', cue: true, transition: false }, { index: 1, chapterId: 'C1', pauseAfterMs: 1000, music: 'suave', cue: false, transition: false }], [25000, 25000 * (sec - 41) / 25], [{ id: 'C1', titulo: 'A' }]);
    const music: [Float32Array, Float32Array] = [sine(330, 0.3, 20, sr2), sine(440, 0.3, 20, sr2)];
    const t0 = performance.now();
    await renderMix({ timeline: t2, sampleRate: sr2, music, getBlock: async () => v.slice(), onChunk: () => {} });
    const perMin = (performance.now() - t0) / (t2.totalMs / 60000);
    console.log(`montagem: ${perMin.toFixed(0)} ms por minuto de áudio`);
    expect(perMin).toBeLessThan(1500);
  });

  it('total = abertura + falas + pausas + encerramento', () => {
    expect(tl.totalMs).toBe(INTRO_MS + 4000 + 6000 + 3000 + OUTRO_MS);
  });
});
