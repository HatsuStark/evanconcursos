import { describe, expect, it } from 'vitest';
import { joinWav } from './wav.ts';

function wav(samples: number[], rate = 10) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  view.setUint32(24, rate, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, s, true));
  return view.buffer;
}

describe('joinWav', () => {
  it('junta os áudios com silêncio depois de cada um e corrige os tamanhos do cabeçalho', () => {
    const view = new DataView(joinWav([wav([1, 2]), wav([3])], 0.2));
    const samples = Array.from({ length: (view.byteLength - 44) / 2 }, (_, i) => view.getInt16(44 + i * 2, true));
    expect(samples).toEqual([1, 2, 0, 0, 3, 0, 0]);
    expect(view.getUint32(4, true)).toBe(view.byteLength - 8);
    expect(view.getUint32(40, true)).toBe(14);
    expect(view.getUint32(24, true)).toBe(10);
  });
});
