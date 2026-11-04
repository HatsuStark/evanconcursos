import { useQueryClient } from '@tanstack/react-query';
import { ListOrdered } from 'lucide-react';
import { useMemo, useState } from 'react';
import { coverage, prioritizeTasks, type PrioritizeSummary } from '../../../shared/domain/coverage.ts';
import { overdueTasks } from '../../../shared/domain/replan.ts';
import { applyReplan, today, useSessionIncidence, type ActivePlan } from '../lib/plans.ts';
import { fmtDate } from './ui.tsx';

const stored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* sem armazenamento */ } };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const PRIORITIZED_DAYS = 14, DISMISS_DAYS = 7;
const daysSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 86_400_000;

// Edital todo visto antes da reta final: pelo ritmo das últimas 3 semanas, avisa quantos temas ficariam para depois do
// início dela e propõe priorizar os mais cobrados. Com tarefa atrasada, quem fala é a reorganização (ReplanBanner).
export function CoverageBanner({ active }: { active: ActivePlan }) {
  const qc = useQueryClient();
  const t0 = today(), dismissKey = `coverage-dismissed:${active.plan.id}`;
  const [dismissed, setDismissed] = useState(() => { const d = stored(dismissKey); return !!d && daysSince(d) < DISMISS_DAYS; });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const eligible = active.plan.pacing === 'agenda' && !active.openEnded && !dismissed && !overdueTasks(active.tasks, t0).length;
  const incidence = useSessionIncidence(active.plan.id, eligible);
  const c = useMemo(() => (eligible && incidence.data ? coverage(active.tasks, incidence.data, t0) : null), [eligible, incidence.data, active.tasks, t0]);
  if (!c) return null;

  const last = active.version?.summary.replan;
  const prioritized = last?.kind === 'prioritize' && !!active.version && daysSince(active.version.created_at) < PRIORITIZED_DAYS;
  const nameOf = (id: string | null) => active.subjects.find((x) => x.id === id)?.name ?? '';
  const risk = c.atRisk.map((t) => t.title.replace(/^[^:]*: /, '')).join('; ');

  async function apply() {
    setBusy(true); setError('');
    try {
      const r = prioritizeTasks(active.tasks, incidence.data!, t0);
      const summary: PrioritizeSummary = { kind: 'prioritize', at: t0, moved: r.tasks.filter((t) => t.kind === 'theory').length, missing: c!.missing };
      await applyReplan(active.plan.id, { supersede: r.supersede, tasks: r.tasks, summary });
      await qc.invalidateQueries();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="glass card replan">
      <ListOrdered size={20} style={{ color: 'var(--orange)', flex: 'none' }} />
      <div style={{ flex: 1, minWidth: 220 }}>
        <strong>{plural(c.missing, 'tema pode ficar', 'temas podem ficar')} para depois da reta final ({fmtDate(c.finalStart)})</strong>
        <ul className="muted small">
          <li>Nas últimas 3 semanas, você concluiu {c.done} de cerca de {c.expected} sessões de teoria que o plano pede no mesmo tempo ({Math.round(c.pace * 100)}%). Nesse ritmo, {plural(c.slots, 'sessão cabe', 'sessões cabem')} até a reta final, e faltam {c.pending} de conteúdo novo.</li>
          {prioritized
            ? <li>Os temas já estão priorizados pela cobrança. O que ficar no fim são os menos cobrados{risk ? ` (ex.: ${risk})` : ''}. Para ver tudo, aumente as horas de estudo nos ajustes do cronograma.</li>
            : <li>Priorizar: em cada matéria, os temas mais cobrados vêm primeiro e os aprofundamentos ficam depois do conteúdo novo, nos mesmos dias. Assim, o que sobrar no fim é o menos cobrado{risk ? ` (ex.: ${risk})` : ''}.</li>}
          {!!c.atRisk.length && <li className="small">Matérias no fim da fila: {[...new Set(c.atRisk.map((t) => nameOf(t.subjectId)).filter(Boolean))].join(', ')}.</li>}
        </ul>
        {error && <p className="error small" style={{ margin: 0 }}>{error}</p>}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {!prioritized && <button className="btn sm" disabled={busy} onClick={apply}>{busy ? <><span className="spinner" /> Priorizando…</> : 'Priorizar'}</button>}
        <button className="btn ghost sm" disabled={busy} onClick={() => { store(dismissKey, new Date().toISOString()); setDismissed(true); }}>{prioritized ? 'Ok' : 'Agora não'}</button>
      </div>
    </div>
  );
}
