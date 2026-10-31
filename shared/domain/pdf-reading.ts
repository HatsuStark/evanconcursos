// Leitura de apostila: tempo estimado de um trecho e posições das marcações na página.
const MINUTES_PER_PAGE = 1.5;

export const readingMinutes = (pages: number) => Math.ceil(pages * MINUTES_PER_PAGE);
export const tooLongForSession = (pages: number, sessionMinutes: number) => sessionMinutes > 0 && readingMinutes(pages) > sessionMinutes;

// [esquerda, topo, largura, altura], em frações da página.
export type MarkRect = [number, number, number, number];

// A camada de texto do PDF quebra a linha em vários pedaços: junta os vizinhos para a marcação não
// escurecer onde eles se sobrepõem.
export function mergeRects(rects: MarkRect[]): MarkRect[] {
  const sorted = [...rects].sort((a, b) => a[1] + a[3] / 2 - (b[1] + b[3] / 2) || a[0] - b[0]);
  const out: MarkRect[] = [];
  for (const [x, y, w, h] of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] + last[3] / 2 - (y + h / 2)) < Math.min(last[3], h) / 2 && x <= last[0] + last[2] + 0.015) {
      const right = Math.max(last[0] + last[2], x + w), top = Math.min(last[1], y), bottom = Math.max(last[1] + last[3], y + h);
      last[0] = Math.min(last[0], x); last[1] = top; last[2] = right - last[0]; last[3] = bottom - top;
    } else out.push([x, y, w, h]);
  }
  return out.map((r) => r.map((n) => Math.round(n * 10000) / 10000) as MarkRect);
}
