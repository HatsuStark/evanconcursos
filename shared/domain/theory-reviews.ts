// Painel de revisões de teoria: separa os temas pela situação da próxima revisão.
export interface ReviewRow { due_on: string; status: string; last_reviewed_at: string | null }

// Espera as revisões em ordem de data. Concluídas ficam da mais recente para a mais antiga.
export function groupReviews<T extends ReviewRow>(rows: T[], today: string) {
  const pending = rows.filter((r) => r.status === 'pending');
  return {
    overdue: pending.filter((r) => r.due_on < today),
    today: pending.filter((r) => r.due_on === today),
    scheduled: pending.filter((r) => r.due_on > today),
    finished: rows.filter((r) => r.status === 'done').sort((a, b) => (b.last_reviewed_at ?? '').localeCompare(a.last_reviewed_at ?? '')),
  };
}

// Revisão sem acúmulo. Nos dias comuns, a "revisão rápida" mostra no máximo DAILY_THEMES temas: primeiro os da 1ª
// revisão (estudados há pouco, o mais recente antes), depois os mais atrasados; o resto espera a revisão da semana. No dia
// da revisão semanal (ou depois dele, enquanto ela não for feita: a semana fica aberta), entram todos os temas vencidos,
// do mais atrasado para o mais recente. Plano sem revisão semanal pela frente: teto maior e nada fica para depois.
export const DAILY_THEMES = 3;
export const DAILY_THEMES_NO_WEEKLY = 5;

export interface WeeklyTask { date: string; kind: string; done_at: string | null }

// `open`: a revisão semanal mais recente até hoje, se ainda não foi feita. `next`: a próxima depois de hoje.
export function weeklyState<T extends WeeklyTask>(tasks: T[], today: string) {
  const weekly = tasks.filter((t) => t.kind === 'weekly_review').sort((a, b) => a.date.localeCompare(b.date));
  const last = weekly.filter((t) => t.date <= today).at(-1);
  return { open: last && !last.done_at ? last : null, next: weekly.find((t) => t.date > today && !t.done_at) ?? null };
}

export type DailyMode = 'daily' | 'weekly' | 'no-weekly';

export function dailyReviews<T extends ReviewRow & { stage: number }>(rows: T[], today: string, weekly: { open: unknown; next: unknown }) {
  const due = rows.filter((r) => r.status === 'pending' && r.due_on <= today);
  if (weekly.open) return { mode: 'weekly' as DailyMode, themes: [...due].sort((a, b) => a.due_on.localeCompare(b.due_on)), deferred: 0 };
  const fresh = due.filter((r) => r.stage === 1).sort((a, b) => b.due_on.localeCompare(a.due_on));
  const rest = due.filter((r) => r.stage !== 1).sort((a, b) => a.due_on.localeCompare(b.due_on));
  const queue = [...fresh, ...rest], cap = weekly.next ? DAILY_THEMES : DAILY_THEMES_NO_WEEKLY;
  return { mode: (weekly.next ? 'daily' : 'no-weekly') as DailyMode, themes: queue.slice(0, cap), deferred: Math.max(0, queue.length - cap) };
}
