import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ERROR_REASONS, type ErrorReason } from '../../../shared/domain/replan.ts';
import { lastErrorReason, setErrorReason } from '../lib/practice.ts';

// Por que errou: ajuda a reorganizar o cronograma (atenção pesa menos que falta de conteúdo) e aparece no desempenho.
export function ErrorReasonPicker({ qid }: { qid: string }) {
  const qc = useQueryClient();
  const current = useQuery({ queryKey: ['error-reason', qid], queryFn: () => lastErrorReason(qid) });
  const [failed, setFailed] = useState(false);
  async function pick(reason: ErrorReason) {
    const next = current.data === reason ? null : reason;
    setFailed(false);
    qc.setQueryData(['error-reason', qid], next);
    try { await setErrorReason(qid, next); void qc.invalidateQueries({ queryKey: ['attempt-stats'] }); void qc.invalidateQueries({ queryKey: ['plan-attempts'] }); }
    catch { setFailed(true); void qc.invalidateQueries({ queryKey: ['error-reason', qid] }); }
  }
  return (
    <div className="q-reason" role="group" aria-label="Por que você errou?">
      <span className="muted small">Por que errou?</span>
      {ERROR_REASONS.map((r) => (
        <button key={r.key} type="button" className={'chip-btn' + (current.data === r.key ? ' on' : '')} aria-pressed={current.data === r.key} onClick={() => void pick(r.key)}>{r.label}</button>
      ))}
      {failed && <span className="error small">Não foi possível salvar.</span>}
    </div>
  );
}
