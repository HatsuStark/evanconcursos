import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Check, Clock, Target } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { KIND_LABEL, setTaskDone, type SubjectRow, type TaskRow } from '../lib/plans.ts';
import { fmtDate, subjectColor, SubjectIcon } from './ui.tsx';

export const KIND_COLOR: Record<string, string> = {
  simulado: 'var(--magenta)', weekly_review: 'var(--lime)', consolidation: 'var(--orange)', final_review: 'var(--orange)', eve: 'var(--cyan)', exam: '#fff',
};
export const taskColor = (t: TaskRow, subjects: SubjectRow[]) => {
  const i = subjects.findIndex((s) => s.id === t.subject_id);
  return t.kind === 'theory' && i >= 0 ? subjectColor(i) : KIND_COLOR[t.kind] ?? (i >= 0 ? subjectColor(i) : 'var(--muted)');
};
const fmtMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m} min`);

// Tarefa do cronograma: matéria, título, tempo previsto, meta de questões e conclusão.
// showDate: para listas com tarefas de vários dias.
export function TaskCard({ task, subjects, showDate }: { task: TaskRow; subjects: SubjectRow[]; showDate?: boolean }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const idx = subjects.findIndex((s) => s.id === task.subject_id), subject = subjects[idx];
  const done = !!task.done_at, color = taskColor(task, subjects);

  async function toggle() {
    setBusy(true);
    try { await setTaskDone(task.id, !done); await qc.invalidateQueries({ queryKey: ['active-plan'] }); } finally { setBusy(false); }
  }

  return (
    <div className={'glass task-card' + (done ? ' done' : '')} style={{ borderLeftColor: color }}>
      {subject ? <SubjectIcon name={subject.name} index={idx} /> : <span className="subject-icon" style={{ color }}><Target /></span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="task-meta">
          <span className="badge" style={{ color, borderColor: 'currentColor' }}>{KIND_LABEL[task.kind] ?? task.kind}</span>
          {subject && <span className="muted small">{subject.name}</span>}
        </div>
        <Link className="task-title" to={`/estudo/${task.id}`}>{task.title}</Link>
        <div className="task-meta">
          {showDate && <span className="chip"><CalendarDays /> {fmtDate(task.date)}</span>}
          {task.minutes > 0 &&<span className="chip"><Clock /> {fmtMinutes(task.minutes)}</span>}
          {task.goal_questions > 0 && <span className="chip"><Target /> {task.goal_questions} questões</span>}
        </div>
      </div>
      {task.kind !== 'exam' && <Link className="btn sm study-btn" to={`/estudo/${task.id}`}>Estudar</Link>}
      {task.kind !== 'exam' && (
        <button className={'check-btn' + (done ? ' on' : '')} disabled={busy} onClick={toggle} aria-pressed={done} aria-label={done ? 'Marcar como não feita' : 'Marcar como feita'}>
          <Check size={18} />
        </button>
      )}
    </div>
  );
}
