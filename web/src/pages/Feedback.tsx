import { useQueryClient } from '@tanstack/react-query';
import { Bug, Check, Lightbulb, MessageSquareText, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Shell } from '../components/Shell.tsx';
import { updateFeedback, useFeedbackList, type FeedbackItem, type FeedbackStatus } from '../lib/feedback.ts';

const KIND = { bug: { label: 'Bug', icon: Bug, badge: 'orange' }, sugestao: { label: 'Sugestão', icon: Lightbulb, badge: 'cyan' }, outro: { label: 'Outro', icon: MessageSquareText, badge: 'violet' } } as const;
const FILTERS: { key: FeedbackStatus | 'todos'; label: string }[] = [
  { key: 'novo', label: 'Novos' }, { key: 'resolvido', label: 'Resolvidos' }, { key: 'descartado', label: 'Descartados' }, { key: 'todos', label: 'Todos' },
];
const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

// Triagem dos relatos enviados pelo balão (só admin).
export function FeedbackPage() {
  const list = useFeedbackList();
  const [filter, setFilter] = useState<FeedbackStatus | 'todos'>('novo');
  const items = (list.data ?? []).filter((f) => filter === 'todos' || f.status === filter);
  const count = (s: FeedbackStatus) => (list.data ?? []).filter((f) => f.status === s).length;
  return (
    <Shell title="Relatos" subtitle="Bugs e sugestões enviados pelo balão">
      {list.isError ? <p className="error">{(list.error as Error).message}</p> : !list.data ? <div className="spinner" /> : (
        <div className="grid" style={{ gap: 14 }}>
          <div className="tabs" role="tablist">
            {FILTERS.map((f) => (
              <button key={f.key} role="tab" aria-selected={filter === f.key} className={'tab' + (filter === f.key ? ' on' : '')} onClick={() => setFilter(f.key)}>
                {f.label}{f.key !== 'todos' && ` (${count(f.key)})`}
              </button>
            ))}
          </div>
          {!items.length && <p className="muted">Nada por aqui.</p>}
          {items.map((f) => <FeedbackCard key={f.id} f={f} />)}
        </div>
      )}
    </Shell>
  );
}

function FeedbackCard({ f }: { f: FeedbackItem }) {
  const qc = useQueryClient();
  const [note, setNote] = useState(f.admin_note ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const k = KIND[f.kind];
  async function save(patch: { status?: FeedbackStatus; note?: string }) {
    setBusy(true); setErr('');
    try { await updateFeedback(f.id, patch); await qc.invalidateQueries({ queryKey: ['feedback-admin'] }); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <article className="glass card" style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={'badge ' + k.badge}><k.icon size={12} /> {k.label}</span>
        <span className="muted small">{f.email ?? '—'} · {when(f.created_at)}</span>
        {!f.emailed && <span className="faint small">(sem e-mail)</span>}
      </div>
      <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.5 }}>{f.message}</p>
      <p className="faint small" style={{ margin: 0, overflowWrap: 'anywhere' }}>
        {f.page && <>Página: <a href={f.page}>{f.page}</a> · </>}{f.user_agent}
      </p>
      <textarea className="textarea" style={{ minHeight: 60 }} placeholder="Nota interna" value={note} onChange={(e) => setNote(e.target.value)}
        onBlur={() => { if (note !== (f.admin_note ?? '')) void save({ note }); }} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {f.status !== 'resolvido' && <button className="btn sm" disabled={busy} onClick={() => save({ status: 'resolvido' })}><Check size={14} /> Resolvido</button>}
        {f.status !== 'descartado' && <button className="btn ghost sm" disabled={busy} onClick={() => save({ status: 'descartado' })}><Trash2 size={14} /> Descartar</button>}
        {f.status !== 'novo' && <button className="btn ghost sm" disabled={busy} onClick={() => save({ status: 'novo' })}><RotateCcw size={14} /> Reabrir</button>}
        {f.email && <a className="btn ghost sm" href={`mailto:${f.email}?subject=${encodeURIComponent('Re: seu relato no Evan Concursos')}`}>Responder</a>}
      </div>
      {err && <p className="error" style={{ margin: 0 }}>{err}</p>}
    </article>
  );
}
