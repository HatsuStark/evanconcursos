import { useQueryClient } from '@tanstack/react-query';
import { CalendarSync } from 'lucide-react';
import { useMemo, useState } from 'react';
import { overdueTasks, replan } from '../../../shared/domain/replan.ts';
import { shiftOverdue } from '../../../shared/domain/rounds.ts';
import { applyReplan, today, usePlanAttempts, type ActivePlan } from '../lib/plans.ts';

const stored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* sem armazenamento */ } };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Proposta de reorganização quando há tarefas atrasadas: mostra o que muda e só grava com a confirmação do estudante.
export function ReplanBanner({ active }: { active: ActivePlan }) {
  const t0 = today(), dismissKey = `replan-dismissed:${active.plan.id}`;
  const [dismissed, setDismissed] = useState(() => stored(dismissKey) === t0);
  const overdue = overdueTasks(active.tasks, t0);
  const show = active.plan.pacing === 'agenda' && !!overdue.length && !dismissed; // no ciclo não há tarefa atrasada
  const attempts = usePlanAttempts(active.plan.id, show && !active.openEnded);
  const plan = useMemo(() => (show && attempts.data ? replan(active.tasks, active.subjects, attempts.data, t0) : null), [show, attempts.data, active, t0]);
  // Sem prazo, nada aperta: as pendentes só andam para a frente.
  const shift = useMemo(() => (show && active.openEnded ? shiftOverdue(active.tasks, active.version?.inputs.hours ?? [], t0) : null), [show, active, t0]);
  if (shift) return <Banner count={overdue.length} lines={[`As pendentes passam para os próximos dias de estudo, na mesma ordem: o plano anda ${plural(shift.shift.days, 'dia de estudo', 'dias de estudo')} para a frente. Sem prazo, nenhum conteúdo se perde.`]}
    disabled={false} apply={() => applyReplan(active.plan.id, { supersede: shift.supersede, tasks: shift.tasks, summary: { ...active.version?.summary.replan, shift: shift.shift } })} onDismiss={() => { store(dismissKey, t0); setDismissed(true); }} />;
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
  return <Banner count={overdue.length} lines={lines} disabled={nothing} apply={() => applyReplan(active.plan.id, plan)} onDismiss={() => { store(dismissKey, t0); setDismissed(true); }} />;
}

function Banner({ count, lines, disabled, apply, onDismiss }: { count: number; lines: string[]; disabled: boolean; apply: () => Promise<void>; onDismiss: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run() {
    setBusy(true); setError('');
    try { await apply(); await qc.invalidateQueries(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="glass card replan">
      <CalendarSync size={20} style={{ color: 'var(--orange)', flex: 'none' }} />
      <div style={{ flex: 1, minWidth: 220 }}>
        <strong>{plural(count, 'tarefa atrasada', 'tarefas atrasadas')}</strong>
        <ul className="muted small">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        {error && <p className="error small" style={{ margin: 0 }}>{error}</p>}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn sm" disabled={busy || disabled} onClick={run}>{busy ? <><span className="spinner" /> Reorganizando…</> : 'Reorganizar'}</button>
        <button className="btn ghost sm" disabled={busy} onClick={onDismiss}>Agora não</button>
      </div>
    </div>
  );
}
