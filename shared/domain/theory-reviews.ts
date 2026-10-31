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
