import { Check, ChevronDown, ChevronUp, Circle, FileUp, PenLine, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cycleProgress, cycleQueue } from '../../../shared/domain/cycle.ts';
import { groupReviews } from '../../../shared/domain/theory-reviews.ts';
import { RebalanceCard } from '../components/RebalanceCard.tsx';
import { OpenPlanCard } from '../components/OpenPlanCard.tsx';
import { CoverageBanner } from '../components/CoverageBanner.tsx';
import { DailyReview } from '../components/DailyReview.tsx';
import { DayPanel } from '../components/DayPanel.tsx';
import { ReplanBanner } from '../components/ReplanBanner.tsx';
import { Shell } from '../components/Shell.tsx';
import { TaskCard } from '../components/TaskCard.tsx';
import { WeekGoals } from '../components/WeekGoals.tsx';
import { daysUntil, fmtDate, subjectColor, SubjectIcon } from '../components/ui.tsx';
import { useAuth } from '../lib/auth.tsx';
import { useDiscursiveRules, useLastDiscursive } from '../lib/discursive.ts';
import { useStudyActivity } from '../lib/goals.ts';
import { useNotices } from '../lib/notices.ts';
import { useDueCounts } from '../lib/practice.ts';
import { prepareGuides, today, useActivePlan } from '../lib/plans.ts';
import { prefetchQuestions } from '../lib/questions.ts';
import { useTheoryReviews } from '../lib/theoryReviews.ts';

const DISCURSIVE_NUDGE_DAYS = 7;
const NEXT_TASKS_STEP = 5;
const CYCLE_SHOWN = 3;

// Tela inicial: o estudo do dia. Sem plano ainda, conduz o primeiro acesso até o cronograma.
export function HomePage() {
  const { session } = useAuth();
  const notices = useNotices();
  const active = useActivePlan();
  const planId = active.data?.plan.id;
  const due = useDueCounts(planId);
  const discursive = useDiscursiveRules(active.data?.notice.id);
  const lastDiscursive = useLastDiscursive(active.data?.notice.id);
  const theoryReviews = useTheoryReviews(planId);
  const activity = useStudyActivity(planId);
  useEffect(() => { if (planId) prepareGuides(planId); }, [planId]);
  // A busca de questões da próxima tarefa começa já na tela Hoje: quando o estudante chega às Questões, a primeira está pronta.
  const nextId = (() => {
    const d = active.data;
    if (!d) return undefined;
    const t0 = today(), open = d.tasks.filter((t) => !t.done_at && t.kind !== 'exam');
    const t = d.plan.pacing === 'ciclo' ? open[0] : open.find((x) => x.date === t0);
    return t && t.goal_questions > 0 && t.kind !== 'simulado' ? t.id : undefined;
  })();
  useEffect(() => { if (nextId) prefetchQuestions(nextId); }, [nextId]);
  const [nextShown, setNextShown] = useState(0);
  const name = session?.user.email?.split('@')[0] ?? '';
  const subtitle = name ? `Olá, ${name}. Pronto para estudar?` : 'Pronto para estudar?';
  if (notices.isLoading || active.isLoading) return <Shell title="Hoje" subtitle={subtitle}><div className="spinner" /></Shell>;

  if (!active.data) {
    const reviewed = notices.data?.find((n) => n.status === 'reviewed'), draft = notices.data?.find((n) => n.status === 'draft');
    const next = reviewed ? { to: `/concursos/${reviewed.id}/questionario`, label: 'Responder o questionário', title: 'Falta pouco: conte sobre sua rotina' }
      : draft ? { to: `/concursos/${draft.id}/conferencia`, label: 'Continuar', title: 'Continue a configuração do seu concurso' }
      : { to: '/concursos/novo', label: 'Enviar edital', title: 'Comece pelo edital do seu concurso' };
    return (
      <Shell title="Hoje" subtitle={subtitle}>
        <div className="hero">
          <span className="badge cyan"><Sparkles size={12} /> Primeiros passos</span>
          <h2 style={{ fontSize: 30, margin: '16px 0 8px', maxWidth: 560 }}>{next.title}</h2>
          <p className="muted" style={{ maxWidth: 560, margin: '0 0 22px' }}>
            A IA lê o edital e organiza matérias, conteúdo e data da prova. Você confere, responde algumas perguntas e recebe o cronograma personalizado.
          </p>
          <Link className="btn" to={next.to}><FileUp size={18} /> {next.label}</Link>
        </div>
      </Shell>
    );
  }

  const { plan, notice, subjects, tasks, version, openEnded } = active.data;
  const isCycle = plan.pacing === 'ciclo';
  const t0 = today(), todays = tasks.filter((t) => t.date === t0), upcoming = tasks.find((t) => t.date > t0 && !t.done_at);
  const days = daysUntil(notice.exam_date);
  const theory = tasks.filter((t) => t.kind === 'theory');
  const nextTasks = tasks.filter((t) => t.date > t0 && !t.done_at && t.kind !== 'exam');
  const queue = cycleQueue(tasks), pace = cycleProgress(tasks, t0), cycleShown = CYCLE_SHOWN + nextShown;
  const reviewGroups = groupReviews(theoryReviews.data ?? [], t0), dueReviews = [...reviewGroups.overdue, ...reviewGroups.today];

  const rail = (
    <>
      {activity.data && <WeekGoals tasks={tasks} activity={activity.data} hours={version?.inputs.hours ?? []} />}
      <section>
        <h3>Conteúdo estudado</h3>
        <div className="grid" style={{ gap: 12 }}>
          {subjects.map((s, i) => {
            const mine = theory.filter((t) => t.subject_id === s.id), doneCount = mine.filter((t) => t.done_at).length, pct = mine.length ? (doneCount / mine.length) * 100 : 0;
            return (
              <details key={s.id} className="glass lesson-group" name="subject-lessons">
                <summary>
                  <SubjectIcon name={s.name} index={i} style={{ width: 36, height: 36 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                    <div className="bar" style={{ marginTop: 6 }}><span style={{ width: `${Math.max(pct, 2)}%`, background: subjectColor(i) }} /></div>
                    <div className="muted small" style={{ marginTop: 6 }}>{doneCount} de {mine.length} aulas</div>
                  </div>
                  <ChevronDown size={16} className="lesson-chevron" />
                </summary>
                {mine.length ? (
                  <ul className="lesson-list">
                    {mine.map((t) => (
                      <li key={t.id}>
                        <Link className="lesson-row" to={`/estudo/${t.id}`}>
                          {t.done_at ? <Check size={15} style={{ color: 'var(--lime)' }} aria-label="Concluída" /> : <Circle size={15} style={{ color: 'var(--faint)' }} aria-label="Não concluída" />}
                          <span style={{ minWidth: 0 }}>
                            <span className="lesson-title">{t.title}</span>
                            {!isCycle && <span className="faint small">{fmtDate(t.date)}</span>}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : <p className="muted small" style={{ margin: 0, padding: '0 12px 12px' }}>Nenhuma aula desta matéria no cronograma.</p>}
              </details>
            );
          })}
        </div>
      </section>
    </>
  );

  return (
    <Shell title="Hoje" subtitle={subtitle} rail={rail}>
      <div className="hero">
        <span className="badge lime">Concurso ativo</span>
        <h2 style={{ fontSize: 28, margin: '14px 0 4px' }}>{notice.role_name}</h2>
        <p className="muted" style={{ margin: '0 0 18px' }}>{[notice.organization, notice.board, openEnded ? 'Sem prazo' : `Prova ${fmtDate(notice.exam_date)}`].filter(Boolean).join(' · ')}</p>
        <DayPanel activity={activity.data ?? []} hours={version?.inputs.hours ?? []} today={t0} todays={isCycle ? [] : todays} examDays={openEnded ? null : days}
          next={isCycle ? queue[0] : todays.find((t) => !t.done_at && t.kind !== 'exam')} reviewsDue={dueReviews.length} />
      </div>
      <OpenPlanCard active={active.data} />
      <RebalanceCard active={active.data} />
      <ReplanBanner active={active.data} />
      <CoverageBanner active={active.data} />
      <DailyReview themes={dueReviews} errors={due.data?.errors ?? 0} cards={due.data?.cards ?? 0} subjects={subjects} today={t0} hasReviews={!!theoryReviews.data?.length} />
      {discursive.data?.rules && (lastDiscursive.data === null || (lastDiscursive.data ?? 0) >= DISCURSIVE_NUDGE_DAYS) && !lastDiscursive.isLoading && (
        <div className="glass card review-today">
          <PenLine size={20} style={{ color: 'var(--violet)' }} />
          <div style={{ flex: 1 }}><strong>Treinar a discursiva</strong><div className="muted small">{lastDiscursive.data === null ? 'Você ainda não fez nenhum treino.' : `Último treino há ${lastDiscursive.data} dias.`}{discursive.data.rules.minPoints && discursive.data.rules.maxPoints ? ` O edital exige ${discursive.data.rules.minPoints} de ${discursive.data.rules.maxPoints} pontos.` : ''}</div></div>
          <Link className="btn ghost sm" to="/discursivas">Treinar</Link>
        </div>
      )}
      {isCycle ? (
        <>
          <div className="section-title"><h2>{openEnded ? 'Próximas tarefas' : 'Próximas do ciclo'}</h2><span className="badge cyan">{pace.done} de {pace.total} tarefas</span></div>
          {!openEnded && (
            <p className="muted small" style={{ margin: '0 0 12px' }}>
              {pace.behind ? `${pace.behind} ${pace.behind === 1 ? 'tarefa' : 'tarefas'} atrás do ritmo para terminar antes da prova.` : pace.ahead ? `${pace.ahead} ${pace.ahead === 1 ? 'tarefa' : 'tarefas'} à frente do ritmo.` : 'No ritmo para terminar antes da prova.'}
            </p>
          )}
          {queue.length ? <div className="grid" style={{ gap: 12 }}>{queue.slice(0, cycleShown).map((t) => <TaskCard key={t.id} task={t} subjects={subjects} />)}</div>
            : <div className="glass card"><p style={{ margin: 0 }}>{openEnded ? 'Montando sua próxima rodada…' : 'Você concluiu todas as tarefas do ciclo.'}</p></div>}
          {queue.length > cycleShown && <button className="btn ghost sm" style={{ marginTop: 12 }} onClick={() => setNextShown(nextShown + NEXT_TASKS_STEP)}>Ver mais</button>}
        </>
      ) : (
        <>
          <div className="section-title"><h2>Estudo do dia</h2><span className="badge cyan">{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' })}</span></div>
          {todays.length ? <div className="grid" style={{ gap: 12 }}>{todays.map((t) => <TaskCard key={t.id} task={t} subjects={subjects} />)}</div> : (
            <div className="glass card">
              <p style={{ margin: 0 }}>Hoje é dia livre no seu cronograma.</p>
              {upcoming && <p className="muted" style={{ margin: '8px 0 0' }}>Próxima tarefa: {fmtDate(upcoming.date)} · {upcoming.title}</p>}
            </div>
          )}
        </>
      )}
      {!isCycle && !!nextTasks.length && (
        <>
          <button className="btn ghost sm" style={{ marginTop: 14 }} aria-expanded={nextShown > 0} onClick={() => setNextShown(nextShown ? 0 : NEXT_TASKS_STEP)}>
            {nextShown ? <><ChevronUp size={15} /> Ocultar próximas tarefas</> : <><ChevronDown size={15} /> Ver próximas tarefas</>}
          </button>
          {nextShown > 0 && <div className="grid" style={{ gap: 12, marginTop: 12 }}>{nextTasks.slice(0, nextShown).map((t) => <TaskCard key={t.id} task={t} subjects={subjects} showDate />)}</div>}
          {nextShown > 0 && nextTasks.length > nextShown && <button className="btn ghost sm" style={{ marginTop: 12 }} onClick={() => setNextShown(nextShown + NEXT_TASKS_STEP)}>Ver mais</button>}
        </>
      )}
    </Shell>
  );
}
