import { BookOpen, CalendarClock, FileUp, Layers, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Shell } from '../components/Shell.tsx';
import { daysUntil, fmtDate, subjectColor, SubjectIcon } from '../components/ui.tsx';
import { useAuth } from '../lib/auth.tsx';
import { useNotices, useNoticeStats } from '../lib/notices.ts';

// Tela inicial: o estudo do dia (a partir da E4). Até lá, conduz o primeiro acesso e mostra o concurso ativo.
export function HomePage() {
  const { session } = useAuth();
  const notices = useNotices();
  const active = notices.data?.find((n) => n.status === 'reviewed') ?? null;
  const draft = notices.data?.find((n) => n.status === 'draft') ?? null;
  const stats = useNoticeStats(active ? [active.id] : []);
  const s = active ? stats.data?.[active.id] : undefined;
  const name = session?.user.email?.split('@')[0] ?? '';
  const days = daysUntil(active?.exam_date);

  const rail = active && s ? (
    <>
      <section>
        <h3>Prova</h3>
        <div className="glass card" style={{ display: 'grid', gap: 6 }}>
          <strong style={{ fontSize: 34, color: 'var(--cyan)', textShadow: '0 0 18px rgba(42,212,232,.5)' }}>{days != null ? Math.max(0, days) : '—'}</strong>
          <span className="muted">dias até {fmtDate(active.exam_date)}</span>
        </div>
      </section>
      <section>
        <h3>Matérias</h3>
        <div className="grid" style={{ gap: 12 }}>
          {s.subjects.slice(0, 8).map((sub, i) => (
            <div key={sub.id} className="glass" style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
              <SubjectIcon name={sub.name} index={i} style={{ width: 36, height: 36 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub.name}</div>
                <div className="bar" style={{ marginTop: 6 }}><span style={{ width: `${sub.weight * 20}%`, background: subjectColor(i), boxShadow: `0 0 10px ${subjectColor(i)}` }} /></div>
              </div>
            </div>
          ))}
        </div>
        <p className="faint small">A barra mostra o peso da matéria no edital. O progresso de estudo aparece aqui a partir do cronograma.</p>
      </section>
    </>
  ) : undefined;

  return (
    <Shell title="Hoje" subtitle={name ? `Olá, ${name}. Pronto para estudar?` : 'Pronto para estudar?'} rail={rail}>
      {notices.isLoading ? <div className="spinner" /> : !active ? (
        <div className="hero">
          <span className="badge cyan"><Sparkles size={12} /> Primeiro passo</span>
          <h2 style={{ fontSize: 30, margin: '16px 0 8px', maxWidth: 560 }}>{draft ? 'Continue a configuração do seu concurso' : 'Comece pelo edital do seu concurso'}</h2>
          <p className="muted" style={{ maxWidth: 560, margin: '0 0 22px' }}>
            A IA lê o PDF, organiza matérias, conteúdo e data da prova. Você confere, responde algumas perguntas e recebe o cronograma personalizado.
          </p>
          <Link className="btn" to={draft ? `/concursos/${draft.id}/conferencia` : '/concursos/novo'}>
            <FileUp size={18} /> {draft ? 'Continuar' : 'Enviar edital'}
          </Link>
        </div>
      ) : (
        <>
          <div className="hero">
            <span className="badge lime">Concurso ativo</span>
            <h2 style={{ fontSize: 28, margin: '14px 0 4px' }}>{active.role_name || active.title}</h2>
            <p className="muted" style={{ margin: '0 0 18px' }}>{[active.organization, active.board].filter(Boolean).join(' · ')}</p>
            <div className="meta-row">
              <span className="chip" style={{ color: 'var(--cyan)' }}><CalendarClock /> Prova {fmtDate(active.exam_date)}</span>
              <span className="chip" style={{ color: 'var(--blue)' }}><Layers /> {s?.subjects.length ?? '…'} matérias</span>
              <span className="chip" style={{ color: 'var(--violet)' }}><BookOpen /> {s?.topics ?? '…'} tópicos</span>
            </div>
          </div>
          <div className="section-title"><h2>Estudo do dia</h2><span className="badge orange">Em construção</span></div>
          <div className="glass card">
            <p style={{ margin: 0 }}>O próximo passo é o <strong>questionário</strong>: horas por dia, seu nível em cada matéria e seus objetivos. Com ele, a IA monta o cronograma e esta tela passa a mostrar as tarefas de hoje.</p>
          </div>
        </>
      )}
    </Shell>
  );
}
