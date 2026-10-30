import { CalendarClock, FilePlus2, Layers } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Shell } from '../components/Shell.tsx';
import { fmtDate, subjectColor, SubjectIcon } from '../components/ui.tsx';
import { useNotices, useNoticeStats } from '../lib/notices.ts';

export function NoticesPage() {
  const notices = useNotices();
  const ids = (notices.data ?? []).map((n) => n.id);
  const stats = useNoticeStats(ids);
  return (
    <Shell title="Concursos" subtitle="Seus editais e planos de estudo."
      actions={<Link className="btn" to="/concursos/novo"><FilePlus2 size={18} /> Novo edital</Link>}>
      {notices.isLoading ? <div className="spinner" /> : !notices.data?.length ? (
        <div className="glass card"><p style={{ margin: 0 }}>Nenhum edital ainda. <Link to="/concursos/novo">Envie o primeiro.</Link></p></div>
      ) : (
        <div className="grid cards">
          {notices.data.map((n, i) => {
            const s = stats.data?.[n.id];
            return (
              <Link key={n.id} to={`/concursos/${n.id}/conferencia`} className="glass course-card" style={{ color: subjectColor(i), textDecoration: 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <SubjectIcon name={n.role_name || n.title} index={i} />
                  <span className={'badge ' + (n.status === 'reviewed' ? 'lime' : 'orange')}>{n.status === 'reviewed' ? 'Conferido' : 'Rascunho'}</span>
                </div>
                <h3>{n.role_name || n.title}</h3>
                <span className="muted small">{[n.organization, n.board].filter(Boolean).join(' · ') || 'Aguardando leitura'}</span>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <span className="chip"><CalendarClock /> {fmtDate(n.exam_date)}</span>
                  {s && <span className="chip"><Layers /> {s.subjects.length} matérias</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
