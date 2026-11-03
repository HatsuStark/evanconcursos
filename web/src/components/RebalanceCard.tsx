import { useQueryClient } from '@tanstack/react-query';
import { Scale } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { scoreGoal, subjectMinPct } from '../../../shared/domain/adaptive.ts';
import { rebalance, REBALANCE_EVERY_DAYS } from '../../../shared/domain/replan.ts';
import { applyReplan, today, usePlanAttempts, type ActivePlan } from '../lib/plans.ts';

const daysSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 864e5;

// Plano com data: a cada 2 semanas sem mudança no cronograma, os blocos futuros de reforço vão para as matérias onde há
// mais pontos a ganhar até a meta. Sem IA; a teoria não muda. Depois, avisa por uma semana o que mudou.
export function RebalanceCard({ active }: { active: ActivePlan }) {
  const qc = useQueryClient();
  const { plan, notice, version, subjects, tasks, openEnded } = active;
  const due = !openEnded && !!version && daysSince(version.created_at) >= REBALANCE_EVERY_DAYS;
  const attempts = usePlanAttempts(plan.id, due);
  const running = useRef(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!due || !attempts.data || running.current) return;
    const blocks = notice.structure?.blocks ?? [];
    const r = rebalance(tasks, subjects.map((s) => ({ id: s.id, questions: s.questions, weight: s.weight, minPct: subjectMinPct(s.block ?? '', blocks) || undefined })),
      attempts.data, scoreGoal(notice.cutoff_pct), today());
    if (!r) return;
    running.current = true;
    applyReplan(plan.id, r).then(() => qc.invalidateQueries()).then(() => { running.current = false; }, (e: Error) => setError(e.message));
  }, [due, attempts.data, tasks]);

  const last = version?.summary.replan;
  if (error) return <p className="error small" role="alert">Não foi possível ajustar o reforço ao seu desempenho: {error}</p>;
  if (last?.kind !== 'rebalance' || !last.focus?.length || daysSince(version!.created_at) > 7) return null;
  const nameOf = (id: string) => subjects.find((s) => s.id === id)?.name ?? '';
  return (
    <div className="glass card open-plan">
      <Scale size={20} style={{ color: 'var(--cyan)', flex: 'none' }} />
      <div style={{ flex: 1, minWidth: 220 }}>
        <strong>Reforço ajustado ao seu desempenho</strong>
        <p className="muted small" style={{ margin: '4px 0 0' }}>
          {last.changed} {last.changed === 1 ? 'bloco de reforço mudou' : 'blocos de reforço mudaram'} de matéria. Mais tempo em {last.focus.map((f) => `${nameOf(f.subjectId)} (${f.rate}% de acerto)`).join(' e ')}, onde há mais pontos a ganhar até a meta. A teoria continua na mesma ordem.
        </p>
      </div>
    </div>
  );
}
