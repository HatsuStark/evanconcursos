// Junta áudios WAV de mesmo formato (PCM de 16 bits, cabeçalho de 44 bytes), com silêncio depois de cada um.
const HEADER = 44;

export function joinWav(parts: ArrayBuffer[], pauseSeconds: number): ArrayBuffer {
  const first = parts[0]!;
  const pause = Math.round(new DataView(first).getUint32(24, true) * pauseSeconds) * 2;
  const size = parts.reduce((total, part) => total + part.byteLength - HEADER + pause, 0);
  const out = new Uint8Array(HEADER + size);
  out.set(new Uint8Array(first, 0, HEADER));
  let at = HEADER;
  for (const part of parts) {
    out.set(new Uint8Array(part, HEADER), at);
    at += part.byteLength - HEADER + pause;
  }
  const view = new DataView(out.buffer);
  view.setUint32(4, out.byteLength - 8, true);
  view.setUint32(40, size, true);
  return out.buffer;
}
