import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, FilePlus2, Layers, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '../components/Shell.tsx';
import { fmtDate, subjectColor, SubjectIcon } from '../components/ui.tsx';
import { deleteNotice, useNotices, useNoticeStats, type NoticeRow } from '../lib/notices.ts';

export function NoticesPage() {
  const qc = useQueryClient();
  const notices = useNotices();
  const ids = (notices.data ?? []).map((n) => n.id);
  const stats = useNoticeStats(ids);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function remove(n: NoticeRow) {
    const name = n.role_name || n.title;
    if (!confirm(`Excluir "${name}"?\n\nSerão apagados: o edital e o PDF, o cronograma e o progresso, as questões respondidas e os simulados deste concurso, seus PDFs de estudo e as anotações, erros, flashcards e marcações de lei que só pertencem a ele.\n\nFica o que também é usado em outro concurso, nas questões livres ou em simulados personalizados.\n\nEsta ação não pode ser desfeita.`)) return;
    setBusy(n.id); setError('');
    try { await deleteNotice(n.id); await qc.invalidateQueries(); }
    catch (e) { setError(`Não foi possível excluir "${name}": ${(e as Error).message} Tente de novo.`); }
    finally { setBusy(''); }
  }

  return (
    <Shell title="Concursos" subtitle="Seus editais e planos de estudo."
      actions={<Link className="btn" to="/concursos/novo"><FilePlus2 size={18} /> Novo edital</Link>}>
      {error && <p className="error">{error}</p>}
      {notices.isLoading ? <div className="spinner" /> : !notices.data?.length ? (
        <div className="glass card"><p style={{ margin: 0 }}>Nenhum edital ainda. <Link to="/concursos/novo">Envie o primeiro.</Link></p></div>
      ) : (
        <div className="grid cards">
          {notices.data.map((n, i) => {
            const s = stats.data?.[n.id];
            return (
              <div key={n.id} className="course-wrap">
                <Link to={n.status === 'reviewed' ? `/concursos/${n.id}/questionario` : `/concursos/${n.id}/conferencia`} className="glass course-card" style={{ color: subjectColor(i), textDecoration: 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <SubjectIcon name={n.role_name || n.title} index={i} />
                    <span className={'badge ' + (n.status === 'reviewed' ? 'lime' : 'orange')}>{n.status === 'reviewed' ? 'Conferido' : 'Rascunho'}</span>
                  </div>
                  <h3>{n.role_name || n.title}</h3>
                  <span className="muted small">{[n.organization, n.board].filter(Boolean).join(' · ') || 'Aguardando leitura'}</span>
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', paddingRight: 40 }}>
                    <span className="chip"><CalendarClock /> {fmtDate(n.exam_date)}</span>
                    {s && <span className="chip"><Layers /> {s.subjects.length} matérias</span>}
                  </div>
                </Link>
                <button className="icon-btn danger course-delete" title="Excluir concurso" aria-label={`Excluir ${n.role_name || n.title}`} disabled={!!busy} onClick={() => remove(n)}>
                  {busy === n.id ? <span className="spinner" /> : <Trash2 size={16} />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
