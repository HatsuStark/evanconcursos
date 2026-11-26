// Leitura de WAV PCM 16 bits (mono ou estéreo) para a trilha, com reamostragem linear.
// WAV PCM 16 bits estéreo (ou mono) → dois canais no sampleRate pedido (interpolação linear basta para uma trilha).
export function readStereoWav(buf: Uint8Array, rate: number): [Float32Array, Float32Array] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (at: number) => String.fromCharCode(buf[at]!, buf[at + 1]!, buf[at + 2]!, buf[at + 3]!);
  let fmt = { ch: 2, sr: 44100, bits: 16 }, at = 12;
  while (at + 8 <= buf.length) {
    const size = view.getUint32(at + 4, true), start = at + 8;
    if (tag(at) === 'fmt ') fmt = { ch: view.getUint16(start + 2, true), sr: view.getUint32(start + 4, true), bits: view.getUint16(start + 14, true) };
    if (tag(at) === 'data') {
      if (fmt.bits !== 16) throw new Error(`WAV de ${fmt.bits} bits não suportado`);
      const frames = Math.floor(Math.min(size, buf.length - start) / (2 * fmt.ch)), n = Math.floor(frames * rate / fmt.sr);
      const L = new Float32Array(n), R = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const pos = i * fmt.sr / rate, k = Math.floor(pos), f = pos - k, k2 = Math.min(frames - 1, k + 1);
        const s = (fr: number, c: number) => view.getInt16(start + (fr * fmt.ch + Math.min(c, fmt.ch - 1)) * 2, true) / 32768;
        L[i] = s(k, 0) * (1 - f) + s(k2, 0) * f; R[i] = s(k, 1) * (1 - f) + s(k2, 1) * f;
      }
      return [L, R];
    }
    at = start + size + (size % 2);
  }
  throw new Error('WAV sem áudio');
}
