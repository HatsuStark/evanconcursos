import { useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { answerTheoryReview, useTaskTheoryReview, type ReviewResult } from '../lib/theoryReviews.ts';
import { fmtDate } from './ui.tsx';

const ANSWERS: { result: ReviewResult; label: string }[] = [
  { result: 'lembrei', label: 'Lembrei bem' },
  { result: 'parcial', label: 'Lembrei em parte' },
  { result: 'esqueci', label: 'Esqueci' },
];

// Modo estudo: aparece quando o tema da tarefa está na data de revisão.
export function TheoryReviewCard({ taskId }: { taskId: string }) {
  const qc = useQueryClient();
  const review = useTaskTheoryReview(taskId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [answered, setAnswered] = useState<{ next: string | null } | null>(null);

  async function answer(id: string, result: ReviewResult) {
    setBusy(true); setError('');
    try {
      setAnswered({ next: await answerTheoryReview(id, result) });
      await qc.invalidateQueries({ queryKey: ['theory-reviews'] });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  if (answered) {
    return (
      <div className="glass card review-today">
        <RotateCcw size={20} style={{ color: 'var(--lime)' }} />
        <span>{answered.next ? `Revisão registrada. Este tema volta em ${fmtDate(answered.next)}.` : 'Revisões deste tema concluídas.'}</span>
      </div>
    );
  }
  if (!review.data) return null;
  const { id, stage } = review.data;
  return (
    <div className="glass card review-today">
      <RotateCcw size={20} style={{ color: 'var(--orange)' }} />
      <div style={{ flex: 1, minWidth: 220 }}>
        <strong>Revisão {stage} de 3 deste tema</strong>
        <div className="muted small">Tente lembrar antes de reler. Depois, veja a revisão curta, faça algumas questões e diga como foi.</div>
        {error && <p className="error" style={{ margin: '6px 0 0' }}>{error}</p>}
      </div>
      {ANSWERS.map((a) => <button key={a.result} className="btn ghost sm" disabled={busy} onClick={() => answer(id, a.result)}>{a.label}</button>)}
    </div>
  );
}
