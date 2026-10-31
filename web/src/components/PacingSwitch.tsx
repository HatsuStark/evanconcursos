import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { setPacing, type Pacing } from '../lib/plans.ts';

const OPTIONS: { key: Pacing; label: string; hint: string }[] = [
  { key: 'agenda', label: 'Agenda', hint: 'Cada tarefa tem um dia no calendário.' },
  { key: 'ciclo', label: 'Ciclo', hint: 'Sem dias fixos: você segue a fila na ordem do plano, no seu ritmo. As datas só medem o ritmo até a prova.' },
];

// Troca entre agenda e ciclo sem refazer o plano: as tarefas e o que já foi feito continuam iguais.
export function PacingSwitch({ planId, pacing }: { planId: string; pacing: Pacing }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function change(next: Pacing) {
    setBusy(true); setError('');
    try { await setPacing(planId, next); await qc.invalidateQueries({ queryKey: ['active-plan'] }); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="segmented">
        {OPTIONS.map((o) => <button key={o.key} className={pacing === o.key ? 'on' : ''} disabled={busy} aria-pressed={pacing === o.key} onClick={() => { if (pacing !== o.key) void change(o.key); }}>{o.label}</button>)}
      </div>
      <p className="muted small" style={{ margin: '8px 0 0' }}>{OPTIONS.find((o) => o.key === pacing)!.hint}</p>
      {error && <p className="error small" style={{ margin: '6px 0 0' }}>{error}</p>}
    </div>
  );
}
