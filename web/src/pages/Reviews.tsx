import { Link } from 'react-router-dom';
import { wholeThemeTitle } from '../../../shared/domain/parts.ts';
import { groupReviews } from '../../../shared/domain/theory-reviews.ts';
import { Shell } from '../components/Shell.tsx';
import { fmtDate } from '../components/ui.tsx';
import { today, useActivePlan } from '../lib/plans.ts';
import { useTheoryReviews, type ReviewResult, type TheoryReview } from '../lib/theoryReviews.ts';
import { useTutorConcepts } from '../lib/tutor.ts';
import { dueConcepts, LEVEL_LABEL, type Level } from '../../../shared/domain/tutor.ts';

const RESULT_LABEL: Record<ReviewResult, string> = { lembrei: 'lembrei bem', parcial: 'lembrei em parte', esqueci: 'esqueci' };

function Group({ title, rows, nameOf, line, action }: {
  title: string; rows: TheoryReview[]; nameOf: (id: string | null) => string; line: (r: TheoryReview) => string; action?: 'Revisar' | 'Abrir';
}) {
  if (!rows.length) return null;
  return (
    <>
      <div className="section-title"><h2>{title}</h2><span className="badge cyan">{rows.length}</span></div>
      <div className="glass card grid" style={{ gap: 12 }}>
        {rows.map((r) => (
          <div key={r.id} className="material-row">
            <div style={{ flex: 1, minWidth: 200 }}>
              <div>{wholeThemeTitle(r.task.title)}</div>
              <div className="muted small">{[nameOf(r.task.subject_id), line(r)].filter(Boolean).join(' · ')}</div>
            </div>
            {action && <Link className="btn ghost sm" to={`/estudo/${r.task_id}${action === 'Revisar' ? '?revisao=1' : ''}`}>{action}</Link>}
          </div>
        ))}
      </div>
    </>
  );
}

// Painel de revisões de teoria: atrasadas, de hoje, programadas e concluídas.
export function ReviewsPage() {
  const active = useActivePlan();
  const reviews = useTheoryReviews(active.data?.plan.id);
  const concepts = useTutorConcepts(active.data?.plan.id);
  const subtitle = 'Cada tema volta em 1, 7 e 30 dias.';
  if (active.isLoading || (active.data && reviews.isLoading)) return <Shell title="Revisões" subtitle={subtitle}><div className="spinner" /></Shell>;
  if (!active.data) return <Shell title="Revisões" subtitle={subtitle}><div className="glass card muted">Monte um cronograma para acompanhar as revisões. <Link to="/concursos">Ir para Concursos</Link></div></Shell>;
  if (reviews.isError) return <Shell title="Revisões" subtitle={subtitle}><p className="error">{(reviews.error as Error).message}</p></Shell>;

  const rows = reviews.data!, g = groupReviews(rows, today());
  const conceptRows = concepts.data ?? [], dueNow = conceptRows.filter((c) => c.due_on && c.due_on <= today()), session = dueConcepts(conceptRows, today());
  const nextConcept = conceptRows.map((c) => c.due_on).filter((d): d is string => !!d).sort()[0];
  const nameOf = (id: string | null) => active.data!.subjects.find((s) => s.id === id)?.name ?? '';
  const stage = (r: TheoryReview) => `revisão ${r.stage} de 3`;
  const last = (r: TheoryReview) => (r.last_result ? `última: ${RESULT_LABEL[r.last_result]}` : '');
  const rail = (
    <section>
      <h3>Situação</h3>
      <div className="stats">
        <div className="stat"><strong style={{ color: 'var(--orange)' }}>{g.overdue.length + g.today.length}</strong><span>para fazer</span></div>
        <div className="stat"><strong style={{ color: 'var(--cyan)' }}>{g.scheduled.length}</strong><span>programadas</span></div>
        <div className="stat"><strong style={{ color: 'var(--lime)' }}>{g.finished.length}</strong><span>concluídas</span></div>
      </div>
      {!!conceptRows.length && (
        <>
          <h3 style={{ marginTop: 18 }}>Conceitos (Aula guiada)</h3>
          <div className="stats">
            {(['dominado', 'em_progresso', 'atencao'] as Level[]).map((lv) => (
              <div key={lv} className="stat"><strong style={{ color: lv === 'dominado' ? 'var(--lime)' : lv === 'atencao' ? 'var(--orange)' : 'var(--cyan)' }}>{conceptRows.filter((c) => c.level === lv).length}</strong><span>{LEVEL_LABEL[lv].toLowerCase()}</span></div>
            ))}
          </div>
        </>
      )}
    </section>
  );

  return (
    <Shell title="Revisões" subtitle={subtitle} rail={rail}>
      {!rows.length && <div className="glass card muted">Nenhum tema ainda. Concluir uma sessão de teoria agenda a primeira revisão.</div>}
      <div className="glass card material-row">
        <div style={{ flex: 1, minWidth: 200 }}>
          <div>Seus áudios</div>
          <div className="muted small">As revisões em áudio que você já gerou, numa playlist organizada pelo que você mais precisa.</div>
        </div>
        <Link className="btn ghost sm" to="/audios">Ouvir</Link>
      </div>
      {!!conceptRows.length && (
        <>
          <div className="section-title"><h2>Conceitos da Aula guiada</h2><span className="badge cyan">{dueNow.length}</span></div>
          <div className="glass card material-row">
            <div style={{ flex: 1, minWidth: 200 }}>
              <div>{dueNow.length ? `${dueNow.length} ${dueNow.length === 1 ? 'conceito vence' : 'conceitos vencem'} hoje` : 'Nenhum conceito para hoje'}</div>
              <div className="muted small">{dueNow.length ? `Sessão curta com perguntas novas: ${session.length} ${session.length === 1 ? 'conceito' : 'conceitos'}, cerca de ${Math.max(1, session.length)} min.` : `Próxima revisão: ${nextConcept ? fmtDate(nextConcept) : '—'}.`} Intervalos de 1, 3, 7 e 14 dias, ajustados ao seu desempenho.</div>
            </div>
            {!!dueNow.length && <Link className="btn ghost sm" to="/aprender/revisao">Revisar</Link>}
          </div>
        </>
      )}
      <Group title="Na fila" rows={g.overdue} nameOf={nameOf} action="Revisar" line={(r) => `${stage(r)} · desde ${fmtDate(r.due_on)}`} />
      <Group title="Hoje" rows={g.today} nameOf={nameOf} action="Revisar" line={stage} />
      <Group title="Programadas" rows={g.scheduled} nameOf={nameOf} line={(r) => [`${stage(r)} em ${fmtDate(r.due_on)}`, last(r)].filter(Boolean).join(' · ')} />
      <Group title="Concluídas" rows={g.finished} nameOf={nameOf} action="Abrir" line={(r) => [`${r.reviews} ${r.reviews === 1 ? 'revisão feita' : 'revisões feitas'}`, last(r)].filter(Boolean).join(' · ')} />
    </Shell>
  );
}
