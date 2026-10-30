import { CalendarClock, CheckCircle2, FileUp, Layers, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Shell } from '../components/Shell.tsx';
import { TaskCard } from '../components/TaskCard.tsx';
import { daysUntil, fmtDate, subjectColor, SubjectIcon } from '../components/ui.tsx';
import { useAuth } from '../lib/auth.tsx';
import { useNotices } from '../lib/notices.ts';
import { today, useActivePlan } from '../lib/plans.ts';

// Tela inicial: o estudo do dia. Sem plano ainda, conduz o primeiro acesso até o cronograma.
export function HomePage() {
  const { session } = useAuth();
  const notices = useNotices();
  const active = useActivePlan();
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

  const { notice, subjects, tasks } = active.data;
  const t0 = today(), todays = tasks.filter((t) => t.date === t0), upcoming = tasks.find((t) => t.date > t0 && !t.done_at);
  const days = daysUntil(notice.exam_date);
  const theory = tasks.filter((t) => t.kind === 'theory');

  const rail = (
    <>
      <section>
        <h3>Prova</h3>
        <div className="glass card" style={{ display: 'grid', gap: 6 }}>
          <strong style={{ fontSize: 34, color: 'var(--cyan)', textShadow: '0 0 18px rgba(42,212,232,.5)' }}>{days != null ? Math.max(0, days) : '—'}</strong>
          <span className="muted">dias até {fmtDate(notice.exam_date)}</span>
        </div>
      </section>
      <section>
        <h3>Conteúdo estudado</h3>
        <div className="grid" style={{ gap: 12 }}>
          {subjects.map((s, i) => {
            const mine = theory.filter((t) => t.subject_id === s.id), pct = mine.length ? (mine.filter((t) => t.done_at).length / mine.length) * 100 : 0;
            return (
              <div key={s.id} className="glass" style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
                <SubjectIcon name={s.name} index={i} style={{ width: 36, height: 36 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                  <div className="bar" style={{ marginTop: 6 }}><span style={{ width: `${Math.max(pct, 2)}%`, background: subjectColor(i), boxShadow: `0 0 10px ${subjectColor(i)}` }} /></div>
                </div>
              </div>
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
        <p className="muted" style={{ margin: '0 0 18px' }}>{[notice.organization, notice.board].filter(Boolean).join(' · ')}</p>
        <div className="meta-row">
          <span className="chip" style={{ color: 'var(--cyan)' }}><CalendarClock /> Prova {fmtDate(notice.exam_date)}</span>
          <span className="chip" style={{ color: 'var(--blue)' }}><Layers /> {subjects.length} matérias</span>
          <span className="chip" style={{ color: 'var(--lime)' }}><CheckCircle2 /> {tasks.filter((t) => t.done_at).length} tarefas feitas</span>
        </div>
      </div>
      <div className="section-title"><h2>Estudo do dia</h2><span className="badge cyan">{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' })}</span></div>
      {todays.length ? <div className="grid" style={{ gap: 12 }}>{todays.map((t) => <TaskCard key={t.id} task={t} subjects={subjects} />)}</div> : (
        <div className="glass card">
          <p style={{ margin: 0 }}>Hoje é dia livre no seu cronograma.</p>
          {upcoming && <p className="muted" style={{ margin: '8px 0 0' }}>Próxima tarefa: {fmtDate(upcoming.date)} · {upcoming.title}</p>}
        </div>
      )}
    </Shell>
  );
}
