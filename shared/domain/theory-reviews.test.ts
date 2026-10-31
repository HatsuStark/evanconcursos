import { describe, expect, it } from 'vitest';
import { groupReviews, type ReviewRow } from './theory-reviews.ts';

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
