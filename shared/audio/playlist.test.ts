import { describe, expect, it } from 'vitest';
import { clipsOf, smartQueue, themeClips, themeWeight, type Clip, type Mark, type ThemeState } from './playlist.ts';

const tl = (chapters: [string, number][], totalMs: number) => ({ blocks: [], totalMs, chapters: chapters.map(([id, startMs]) => ({ id, titulo: `Cap ${id}`, startMs })) });
const clip = (reviewId: string, chapterId: string, themeIds: string[], createdAt: string, len = 60_000, startMs = 0): Clip =>
  ({ key: `${reviewId}:${chapterId}`, reviewId, chapterId, title: chapterId, startMs, endMs: startMs + len, themeIds, createdAt });
const theme = (id: string, p: Partial<ThemeState> = {}): ThemeState => ({ id, title: id, subject: 'S', overdue: false, attempts: 10, acc: 0.7, ...p });

describe('playlist das revisões em áudio', () => {
  it('trechos: do começo do capítulo ao começo do seguinte, com as sessões dos temas', () => {
    const c = clipsOf({
      id: 'r1', createdAt: '2026-11-20', timeline: tl([['c1', 0], ['c2', 30_000], ['c3', 90_000], ['c4', 92_000]], 200_000),
      chapters: [{ id: 'c1', temas: ['T1'], etapa: 'preparacao' }, { id: 'c2', temas: ['T1', 'T2', 'T9'] }, { id: 'c3', temas: ['T1'] }, { id: 'c4', temas: ['T2'] }],
      themeIds: [['sessA', 'T1'], ['sessB', 'T2']],
    });
    expect(c.map((x) => [x.chapterId, x.startMs, x.endMs, x.themeIds])).toEqual([
      ['c1', 0, 30_000, []], ['c2', 30_000, 90_000, ['sessA', 'sessB']], ['c4', 92_000, 200_000, ['sessB']],
    ]); // c3 tem 2 s: sai
  });

  it('peso do tema: vencida, acerto baixo, pouca prática; dominado fica de fora', () => {
    expect(themeWeight(theme('a', { overdue: true, acc: 0.5 }))).toEqual({ score: 5, reasons: ['revisão vencida', 'acerto 50%'] });
    expect(themeWeight(theme('a', { attempts: 1, acc: 1 }))).toEqual({ score: 1, reasons: ['pouca prática em questões'] });
    expect(themeWeight(theme('a', { acc: 0.9 }))).toBeNull();
    expect(themeWeight(theme('a', { acc: 0.9, overdue: true }))?.score).toBe(3);
  });

  it('fila: fixados primeiro, tirados nunca, só a revisão mais recente de cada tema, até o tempo pedido', () => {
    const clips = [
      clip('old', 'x', ['A'], '2026-11-01'), clip('new', 'y', ['A'], '2026-11-15'),
      clip('new', 'z', ['B'], '2026-11-15', 60_000, 60_000), clip('new', 'w', ['C'], '2026-11-15', 60_000, 120_000),
      clip('new', 'abertura', [], '2026-11-15'), clip('old', 'fix', ['D'], '2026-11-01'),
    ];
    const themes = [theme('A', { acc: 0.7 }), theme('B', { overdue: true }), theme('C', { acc: 0.95 }), theme('D', { acc: 0.95 })];
    const marks = new Map<string, Mark>([['old:fix', 'pin']]);
    const q = smartQueue(clips, themes, marks, 10 * 60_000);
    expect(q.map((i) => i.clip.key)).toEqual(['old:fix', 'new:z', 'new:y']);
    expect(q[0]!.reasons).toEqual(['fixado']);
    marks.set('new:z', 'hide');
    expect(smartQueue(clips, themes, marks, 10 * 60_000).map((i) => i.clip.key)).toEqual(['old:fix', 'new:y']);
    expect(smartQueue(clips, themes, new Map(), 60_000).map((i) => i.clip.key)).toEqual(['new:z']);
  });

  it('por tema: todas as semanas, a mais recente primeiro', () => {
    const clips = [clip('old', 'x', ['A'], '2026-11-01'), clip('new', 'y', ['A', 'B'], '2026-11-15'), clip('new', 'z', ['B'], '2026-11-15')];
    expect(themeClips(clips, 'A').map((c) => c.key)).toEqual(['new:y', 'old:x']);
  });
});
