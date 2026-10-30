import { useQueryClient } from '@tanstack/react-query';
import { CalendarSync } from 'lucide-react';
import { useMemo, useState } from 'react';
import { overdueTasks, replan } from '../../../shared/domain/replan.ts';
import { applyReplan, today, usePlanAttempts, type ActivePlan } from '../lib/plans.ts';

const stored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* sem armazenamento */ } };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Proposta de reorganização quando há tarefas atrasadas: mostra o que muda e só grava com a confirmação do estudante.
export function ReplanBanner({ active }: { active: ActivePlan }) {
  const qc = useQueryClient();
  const t0 = today(), dismissKey = `replan-dismissed:${active.plan.id}`;
  const [dismissed, setDismissed] = useState(() => stored(dismissKey) === t0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const overdue = overdueTasks(active.tasks, t0);
  const show = !!overdue.length && !dismissed;
  const attempts = usePlanAttempts(active.plan.id, show);
  const plan = useMemo(() => (show && attempts.data ? replan(active.tasks, active.subjects, attempts.data, t0) : null), [show, attempts.data, active, t0]);
  if (!show || !plan) return null;

  const s = plan.summary, nameOf = (id: string) => active.subjects.find((x) => x.id === id)?.name ?? '';
  const taken = [
    s.absorbed.consolidation && plural(s.absorbed.consolidation, 'dia de consolidação', 'dias de consolidação'),
    s.absorbed.final_review && plural(s.absorbed.final_review, 'dia de revisão final', 'dias de revisão final'),
    s.absorbed.weekly_review && plural(s.absorbed.weekly_review, 'revisão semanal', 'revisões semanais'),
  ].filter(Boolean).join(', ');
  const lines = [
    s.overdueTheory > 0 && `${plural(s.overdueTheory, 'sessão atrasada volta', 'sessões atrasadas voltam')} para a agenda a partir de hoje, na mesma ordem; nenhum conteúdo se perde.`,
    taken && `Para abrir espaço, usa ${taken}.`,
    s.crowdedDays > 0 && `Falta tempo até a prova: ${plural(s.crowdedDays, 'dia fica', 'dias ficam')} com mais de uma sessão.`,
    s.unplaced > 0 && `Não há mais dias de estudo até a prova: ${plural(s.unplaced, 'sessão continua atrasada', 'sessões continuam atrasadas')}.`,
    s.overdueOther > 0 && `${plural(s.overdueOther, 'revisão ou simulado que passou sai', 'revisões ou simulados que passaram saem')} da agenda.`,
    s.weakest.length > 0 && `Os dias de reforço restantes dão mais atenção a ${s.weakest.map(nameOf).join(' e ')}.`,
  ].filter(Boolean) as string[];
  const nothing = !plan.tasks.length && !plan.supersede.length;

  async function apply() {
    setBusy(true); setError('');
    try { await applyReplan(active.plan.id, plan!); await qc.invalidateQueries(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="glass card replan">
      <CalendarSync size={20} style={{ color: 'var(--orange)', flex: 'none' }} />
      <div style={{ flex: 1, minWidth: 220 }}>
        <strong>{plural(overdue.length, 'tarefa atrasada', 'tarefas atrasadas')}</strong>
        <ul className="muted small">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        {error && <p className="error small" style={{ margin: 0 }}>{error}</p>}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn sm" disabled={busy || nothing} onClick={apply}>{busy ? <><span className="spinner" /> Reorganizando…</> : 'Reorganizar'}</button>
        <button className="btn ghost sm" disabled={busy} onClick={() => { store(dismissKey, t0); setDismissed(true); }}>Agora não</button>
      </div>
    </div>
  );
}
