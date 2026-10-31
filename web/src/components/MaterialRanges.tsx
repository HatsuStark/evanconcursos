import { useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ymd } from '../../../shared/domain/dates.ts';
import { materialSchedule, type ScheduleSession } from '../../../shared/domain/material-schedule.ts';
import { deleteSessionPages, updateSessionPages, useMaterialPages, type Material, type MaterialPages } from '../lib/materials.ts';
import { KIND_LABEL, useActivePlan, type TaskRow } from '../lib/plans.ts';
import { RangeEditor } from './RangeEditor.tsx';
import { fmtDate } from './ui.tsx';

type Range = MaterialPages & { title: string; subject: string };

// Em que partes do cronograma a apostila entra: matéria, sessão, páginas e as tarefas de cada sessão.
export function MaterialRanges({ material, onOpen }: { material: Material; onOpen: (p: MaterialPages) => void }) {
  const qc = useQueryClient();
  const pages = useMaterialPages(material.id);
  const plan = useActivePlan();
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['material-pages', material.id] }), qc.invalidateQueries({ queryKey: ['session-pages'] })]);
  async function remove(p: Range) {
    if (!confirm(`Tirar o trecho de "${p.title}"?`)) return;
    setError('');
    try { await deleteSessionPages(p.id); await refresh(); } catch (e) { setError((e as Error).message); }
  }
  if (pages.isLoading || plan.isLoading) return <div className="spinner" />;
  if (!pages.data?.length) return <p className="muted small" style={{ margin: 0, width: '100%' }}>Esta apostila ainda não entrou em nenhuma parte do cronograma.</p>;

  const isCycle = plan.data?.plan.pacing === 'ciclo';
  const today = ymd(new Date());
  const ranges: Range[] = pages.data.map((p) => ({ ...p, title: p.session?.title ?? 'Sessão', subject: p.session?.subject?.name ?? 'Sem matéria' }));
  const schedule = materialSchedule<Range, TaskRow>(ranges, plan.data?.tasks ?? []);
  const { sessions, tasks, done } = schedule.totals;

  const session = (s: ScheduleSession<Range, TaskRow>) => (
    <li key={s.sessionId} className="material-session">
      <span>{s.title}</span>
      {s.ranges.map((p) => (
        <div key={p.id}>
          <div className="material-range">
            <span className="muted small" style={{ flex: 1, minWidth: 0 }}>{p.page_from === p.page_to ? `Página ${p.page_from}` : `Páginas ${p.page_from} a ${p.page_to}`}{p.manual ? ' · ajustado por você' : ''}</span>
            <button className="btn ghost sm" onClick={() => onOpen(p)}>Abrir</button>
            <button className="icon-btn" title="Ajustar páginas" aria-label={`Ajustar páginas de ${p.title}`} onClick={() => setEditing(editing === p.id ? null : p.id)}><Pencil size={15} /></button>
            <button className="icon-btn" title="Tirar trecho" aria-label={`Tirar trecho de ${p.title}`} onClick={() => remove(p)}><Trash2 size={15} /></button>
          </div>
          {editing === p.id && <RangeEditor from={p.page_from} to={p.page_to} max={material.pages ?? undefined} onCancel={() => setEditing(null)} onSave={async (a, b) => { await updateSessionPages(p.id, a, b); setEditing(null); await refresh(); }} />}
        </div>
      ))}
      {!!s.tasks.length && (
        <div className="material-tasks">
          {s.tasks.map((t) => {
            const late = !isCycle && !t.done_at && t.date < today;
            return (
              <Link key={t.id} to={`/estudo/${t.id}`} className={`material-task${t.done_at ? ' done' : late ? ' late' : ''}`}>
                {t.done_at && <Check size={13} aria-hidden />}
                {KIND_LABEL[t.kind] ?? t.kind} · {t.done_at ? 'feita' : isCycle ? 'na fila' : `${fmtDate(t.date)}${late ? ' · atrasada' : ''}`}
              </Link>
            );
          })}
        </div>
      )}
    </li>
  );

  return (
    <div className="material-ranges">
      {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
      <p className="muted small" style={{ margin: 0 }}>
        {sessions} {sessions === 1 ? 'sessão' : 'sessões'} · {done} de {tasks} {tasks === 1 ? 'tarefa feita' : 'tarefas feitas'}
        {schedule.next && !isCycle ? ` · próxima em ${fmtDate(schedule.next.date)}` : ''}
      </p>
      {schedule.subjects.map((g) => (
        <section key={g.name}>
          <strong className="small">{g.name}</strong>
          <ul className="material-sessions">{g.sessions.map(session)}</ul>
        </section>
      ))}
      {!!schedule.outside.length && (
        <section>
          <strong className="small">Fora do cronograma atual</strong>
          <ul className="material-sessions">{schedule.outside.map(session)}</ul>
        </section>
      )}
    </div>
  );
}
