import { describe, expect, it } from 'vitest';
import { dailyReviews, groupReviews, weeklyState, type ReviewRow } from './theory-reviews.ts';

const row = (due_on: string, status = 'pending', last_reviewed_at: string | null = null): ReviewRow => ({ due_on, status, last_reviewed_at });

describe('groupReviews', () => {
  it('separa atrasadas, de hoje e programadas', () => {
    const late = row('2026-10-01'), now = row('2026-10-10'), later = row('2026-10-11');
    expect(groupReviews([late, now, later], '2026-10-10')).toEqual({ overdue: [late], today: [now], scheduled: [later], finished: [] });
  });
  it('concluída não entra nas pendentes, mesmo com data passada, e a mais recente vem primeiro', () => {
    const old = row('2026-09-01', 'done', '2026-09-01T10:00:00Z'), recent = row('2026-09-02', 'done', '2026-10-01T10:00:00Z');
    const g = groupReviews([old, recent], '2026-10-10');
    expect(g.overdue).toEqual([]);
    expect(g.finished).toEqual([recent, old]);
  });
});

const rev = (due_on: string, stage: number, status = 'pending') => ({ due_on, stage, status, last_reviewed_at: null });
const wk = (date: string, done_at: string | null = null) => ({ date, kind: 'weekly_review', done_at });

describe('weeklyState', () => {
  it('a semana fica aberta até ser feita e a próxima vem depois de hoje', () => {
    const past = wk('2026-11-15'), next = wk('2026-11-22');
    expect(weeklyState([next, past, { date: '2026-11-18', kind: 'theory', done_at: null }], '2026-11-18')).toEqual({ open: past, next });
  });
  it('feita, não fica aberta; só vale a mais recente até hoje', () => {
    expect(weeklyState([wk('2026-11-08'), wk('2026-11-15', 'x')], '2026-11-18')).toEqual({ open: null, next: null });
    const today = wk('2026-11-22');
    expect(weeklyState([wk('2026-11-15'), today], '2026-11-22').open).toBe(today);
  });
});

describe('dailyReviews', () => {
  const t = '2026-11-18';
  it('dia comum: 3 temas, 1ª revisão primeiro (a mais recente antes), o resto fica para a semana', () => {
    const a = rev('2026-11-10', 2), b = rev('2026-11-17', 1), c = rev('2026-11-18', 1), d = rev('2026-11-05', 3), e = rev('2026-11-19', 1);
    const r = dailyReviews([a, b, c, d, e], t, { open: null, next: wk('2026-11-22') });
    expect(r).toEqual({ mode: 'daily', themes: [c, b, d], deferred: 1 });
  });
  it('dia da revisão semanal: todos os vencidos, do mais atrasado', () => {
    const a = rev('2026-11-10', 2), b = rev('2026-11-17', 1), c = rev('2026-11-01', 1), done = rev('2026-11-01', 3, 'done');
    expect(dailyReviews([a, b, c, done], t, { open: wk(t), next: null })).toEqual({ mode: 'weekly', themes: [c, a, b], deferred: 0 });
  });
  it('sem revisão semanal pela frente: teto maior', () => {
    const rows = Array.from({ length: 7 }, (_, i) => rev(`2026-11-1${i}`, 1));
    const r = dailyReviews(rows, t, { open: null, next: null });
    expect([r.mode, r.themes.length, r.deferred]).toEqual(['no-weekly', 5, 2]);
  });
});
