import { useQueryClient } from '@tanstack/react-query';
import { FileUp, Infinity as InfinityIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { firstPassWeeks, masteryPercent, needsRound, nextRound } from '../../../shared/domain/rounds.ts';
import { applyReplan, today, usePlanAttempts, type ActivePlan } from '../lib/plans.ts';
import { fmtDate } from './ui.tsx';

// Plano sem prazo: avisa que o edital não está aberto, mostra o progresso e monta a próxima rodada quando a fila acaba.
export function OpenPlanCard({ active }: { active: ActivePlan }) {
  const qc = useQueryClient();
  const { plan, notice, version, subjects, tasks, openEnded } = active;
  const attempts = usePlanAttempts(plan.id, openEnded);
  const building = useRef(false);
  const [error, setError] = useState('');
  const hours = version?.inputs.hours ?? [];

  useEffect(() => {
    if (!openEnded || !attempts.data || building.current || !needsRound(tasks)) return;
    const round = nextRound({ tasks, subjects, attempts: attempts.data, hours, weeklyReview: !!version?.inputs.weeklyReview, totalQuestions: notice.total_questions, today: today() });
    if (!round) return;
    building.current = true;
    applyReplan(plan.id, round).then(() => qc.invalidateQueries()).then(() => { building.current = false; }, (e: Error) => setError(e.message));
  }, [openEnded, attempts.data, tasks]);

  if (!openEnded) return null;
  const pendingTheory = tasks.filter((t) => t.kind === 'theory' && !t.done_at).length;
  const round = version?.summary.replan?.round, nameOf = (id: string) => subjects.find((s) => s.id === id)?.name ?? '';
  const status = pendingTheory
    ? `Primeira volta pelo conteúdo: ${pendingTheory === 1 ? 'falta 1 sessão' : `faltam ${pendingTheory} sessões`}, cerca de ${firstPassWeeks(pendingTheory, hours)} ${firstPassWeeks(pendingTheory, hours) === 1 ? 'semana' : 'semanas'} no seu ritmo.`
    : round?.weakest.length
      ? `Esta rodada dá mais atenção a ${round.weakest.map((w) => `${nameOf(w.subjectId)} (cerca de ${w.rate}% de acerto)`).join(' e ')}.`
      : 'Esta rodada mantém em dia os temas que você não vê há mais tempo.';

  return (
    <div className="glass card open-plan">
      <InfinityIcon size={20} style={{ color: 'var(--cyan)', flex: 'none' }} />
      <div style={{ flex: 1, minWidth: 220 }}>
        <strong>Plano sem prazo</strong>
        <p className="muted small" style={{ margin: '4px 0 0' }}>{notice.exam_date ? `Este edital não está aberto: a prova foi em ${fmtDate(notice.exam_date)}.` : 'Este edital não informa a data da prova.'} Seu plano se adapta ao seu desempenho, com mais tempo no que está fraco. Não há data final nem tarefa atrasada.</p>
        <p className="small" style={{ margin: '6px 0 0' }}>{status}</p>
        {error && <p className="error small" style={{ margin: '6px 0 0' }} role="alert">Não foi possível montar a próxima rodada: {error}</p>}
        <Link className="btn ghost sm" style={{ marginTop: 10 }} to={`/concursos/novo?atualizar=${notice.id}`}><FileUp size={15} /> Saiu novo edital?</Link>
      </div>
      {attempts.data && (
        <div className="open-plan-score">
          <strong>{masteryPercent(tasks, subjects, attempts.data)}%</strong>
          <span className="muted small">do edital dominado</span>
        </div>
      )}
    </div>
  );
}
