import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, RefreshCw, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { cycleProgress, cycleQueue } from '../../../shared/domain/cycle.ts';
import { parseYmd, ymd } from '../../../shared/domain/dates.ts';
import { OpenPlanCard } from '../components/OpenPlanCard.tsx';
import { PacingSwitch } from '../components/PacingSwitch.tsx';
import { ReplanBanner } from '../components/ReplanBanner.tsx';
import { Shell } from '../components/Shell.tsx';
import { TaskCard, taskColor } from '../components/TaskCard.tsx';
import { fmtDate, subjectColor } from '../components/ui.tsx';
import { KIND_LABEL, today, useActivePlan } from '../lib/plans.ts';

const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const QUEUE_STEP = 20;

// Cronograma: calendário do mês com as tarefas, detalhe do dia escolhido e a estratégia da IA ao lado.
export function SchedulePage() {
  const active = useActivePlan();
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selected, setSelected] = useState(today());
  const [queueShown, setQueueShown] = useState(QUEUE_STEP);
  const byDate = useMemo(() => {
    const m = new Map<string, NonNullable<typeof active.data>['tasks']>();
    for (const t of active.data?.tasks ?? []) { if (!m.has(t.date)) m.set(t.date, []); m.get(t.date)!.push(t); }
    return m;
  }, [active.data]);

  if (active.isLoading) return <Shell title="Cronograma"><div className="spinner" /></Shell>;
  if (!active.data) {
    return (
      <Shell title="Cronograma">
        <div className="hero"><h2 style={{ marginTop: 0 }}>Nenhum cronograma ainda</h2>
          <p className="muted">Envie e confira o edital, responda o questionário e o cronograma aparece aqui.</p>
          <Link className="btn" to="/concursos">Ir para concursos</Link></div>
      </Shell>
    );
  }
  const { plan, notice, version, subjects, tasks, openEnded } = active.data;
  const isCycle = plan.pacing === 'ciclo';
  const done = tasks.filter((t) => t.done_at).length, studyTasks = tasks.filter((t) => t.kind !== 'exam');

  // Grade do mês começando na segunda-feira.
  const first = new Date(month), lead = (first.getDay() + 6) % 7;
  const cells = Array.from({ length: Math.ceil((lead + new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()) / 7) * 7 }, (_, i) => {
    const d = new Date(month); d.setDate(1 - lead + i); return d;
  });
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const dayTasks = byDate.get(selected) ?? [];
  const perSubject = version?.summary.perSubject ?? [];
  const maxDays = Math.max(1, ...perSubject.map((p) => p.days));

  const rail = (
    <>
      <section>
        <h3>Progresso</h3>
        <div className="glass card" style={{ display: 'grid', gap: 8 }}>
          <strong style={{ fontSize: 30, color: 'var(--lime)', textShadow: '0 0 16px rgba(181,229,80,.4)' }}>{done}<span className="muted" style={{ fontSize: 16 }}> / {studyTasks.length}</span></strong>
          <div className="bar"><span style={{ width: `${(done / Math.max(1, studyTasks.length)) * 100}%`, background: 'var(--lime)', boxShadow: '0 0 10px var(--lime)' }} /></div>
          <span className="muted small">tarefas concluídas{openEnded ? ' · sem prazo' : ` · prova em ${fmtDate(notice.exam_date)}`}</span>
        </div>
      </section>
      {!!version?.strategy.advice.length && (
        <section>
          <h3><Sparkles size={13} style={{ verticalAlign: -2 }} /> Estratégia da IA</h3>
          <ul className="advice">{version.strategy.advice.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </section>
      )}
      {!!version?.strategy.fallbacks?.length && (
        <section>
          <div className="warning-card"><AlertTriangle /><span>Parte do plano foi montada sem IA ({version.strategy.fallbacks.length} item(ns)). O conteúdo segue a ordem do edital.</span></div>
        </section>
      )}
      <section>
        <h3>Dias de teoria por matéria</h3>
        <div className="grid" style={{ gap: 10 }}>
          {perSubject.map((p) => {
            const i = subjects.findIndex((s) => s.id === p.subjectId), focus = version?.strategy.subjects.find((s) => s.subjectId === p.subjectId)?.focus;
            return (
              <div key={p.subjectId} title={focus || undefined}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{p.name}</span><span className="muted">{p.days}</span></div>
                <div className="bar" style={{ marginTop: 5 }}><span style={{ width: `${(p.days / maxDays) * 100}%`, background: subjectColor(i), boxShadow: `0 0 8px ${subjectColor(i)}` }} /></div>
              </div>
            );
          })}
        </div>
      </section>
      <section>
        <p className="faint small" style={{ margin: '0 0 10px' }}>Versão {version?.number}{version?.reason === 'adaptive' ? (openEnded ? ' (rodada adaptativa)' : ' (reorganizada)') : ''} · {version && new Date(version.created_at).toLocaleDateString('pt-BR')}</p>
        <Link className="btn ghost sm" to={`/concursos/${notice.id}/questionario`}><RefreshCw size={15} /> Refazer cronograma</Link>
      </section>
    </>
  );

  if (isCycle) {
    const queue = cycleQueue(tasks), pace = cycleProgress(tasks, today());
    return (
      <Shell title="Cronograma" subtitle={[notice.role_name, notice.board].filter(Boolean).join(' · ')} rail={rail}>
        {openEnded ? <OpenPlanCard active={active.data} /> : <PacingSwitch planId={plan.id} pacing={plan.pacing} />}
        <div className="section-title"><h2>{openEnded ? 'Sua fila' : 'Fila do ciclo'}</h2><span className="badge cyan">{queue.length} {queue.length === 1 ? 'pendente' : 'pendentes'}</span></div>
        {!openEnded && !!pace.behind && <p className="muted small" style={{ margin: '0 0 12px' }}>{pace.behind} {pace.behind === 1 ? 'tarefa' : 'tarefas'} atrás do ritmo para terminar antes da prova.</p>}
        {queue.length ? <div className="grid" style={{ gap: 12 }}>{queue.slice(0, queueShown).map((t) => <TaskCard key={t.id} task={t} subjects={subjects} />)}</div>
          : <div className="glass card muted">{openEnded ? 'Montando sua próxima rodada…' : 'Você concluiu todas as tarefas do ciclo.'}</div>}
        {queue.length > queueShown && <button className="btn ghost sm" style={{ marginTop: 12 }} onClick={() => setQueueShown(queueShown + QUEUE_STEP)}>Ver mais</button>}
      </Shell>
    );
  }

  return (
    <Shell title="Cronograma" subtitle={[notice.role_name, notice.board].filter(Boolean).join(' · ')} rail={rail}
      actions={
        <div className="month-nav glass">
          <button className="icon-btn" onClick={() => shift(-1)} aria-label="Mês anterior"><ChevronLeft size={18} /></button>
          <strong>{month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase())}</strong>
          <button className="icon-btn" onClick={() => shift(1)} aria-label="Próximo mês"><ChevronRight size={18} /></button>
        </div>
      }>
      <PacingSwitch planId={plan.id} pacing={plan.pacing} />
      <ReplanBanner active={active.data} />
      <div className="calendar glass" role="grid" aria-label="Calendário de estudos">
        {WEEKDAYS.map((d) => <div key={d} className="cal-head" role="columnheader">{d}</div>)}
        {cells.map((d) => {
          const key = ymd(d), list = byDate.get(key) ?? [], out = d.getMonth() !== month.getMonth();
          return (
            <button key={key} role="gridcell" className={'cal-cell' + (out ? ' out' : '') + (key === today() ? ' today' : '') + (key === selected ? ' selected' : '')}
              onClick={() => setSelected(key)} aria-label={`${d.toLocaleDateString('pt-BR')}: ${list.length ? list.map((t) => t.title).join('; ') : 'sem tarefas'}`}>
              <span className="cal-day">{d.getDate()}</span>
              {list.map((t) => (
                <span key={t.id} className={'cal-chip' + (t.done_at ? ' done' : '') + (t.kind === 'exam' ? ' exam' : '')} style={{ color: taskColor(t, subjects) }}>
                  {t.kind === 'theory' ? subjects.find((s) => s.id === t.subject_id)?.name : KIND_LABEL[t.kind]}
                </span>
              ))}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button className="btn ghost sm" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setSelected(today()); }}><CalendarDays size={15} /> Hoje</button>
      </div>

      <div className="section-title"><h2>{parseYmd(selected)?.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</h2></div>
      {dayTasks.length ? <div className="grid" style={{ gap: 12 }}>{dayTasks.map((t) => <TaskCard key={t.id} task={t} subjects={subjects} />)}</div>
        : <div className="glass card muted">Dia livre.</div>}
    </Shell>
  );
}
