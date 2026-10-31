import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { deleteSessionPages, updateSessionPages, useMaterialPages, type Material, type MaterialPages } from '../lib/materials.ts';
import { RangeEditor } from './RangeEditor.tsx';

// Todos os trechos de uma apostila, para conferir o mapeamento de uma vez e abrir ou corrigir cada um.
export function MaterialRanges({ material, onOpen }: { material: Material; onOpen: (p: MaterialPages) => void }) {
  const qc = useQueryClient();
  const pages = useMaterialPages(material.id);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['material-pages', material.id] }), qc.invalidateQueries({ queryKey: ['session-pages'] })]);
  async function remove(p: MaterialPages) {
    if (!confirm(`Tirar o trecho de "${p.session?.title ?? 'sessão'}"?`)) return;
    setError('');
    try { await deleteSessionPages(p.id); await refresh(); } catch (e) { setError((e as Error).message); }
  }
  if (pages.isLoading) return <div className="spinner" />;
  if (!pages.data?.length) return <p className="muted small" style={{ margin: 0, width: '100%' }}>Nenhum trecho ligado a sessões do cronograma.</p>;
  return (
    <ul className="material-ranges">
      {error && <li className="error" role="alert">{error}</li>}
      {pages.data.map((p) => (
        <li key={p.id}>
          <div className="material-range">
            <div style={{ flex: 1, minWidth: 0 }}>
              <span>{p.session?.title ?? 'Sessão'}</span>
              <div className="muted small">{p.session?.subject?.name ? `${p.session.subject.name} · ` : ''}páginas {p.page_from} a {p.page_to}{p.manual ? ' · ajustado por você' : ''}</div>
            </div>
            <button className="btn ghost sm" onClick={() => onOpen(p)}>Abrir</button>
            <button className="icon-btn" title="Ajustar páginas" aria-label={`Ajustar páginas de ${p.session?.title ?? 'sessão'}`} onClick={() => setEditing(editing === p.id ? null : p.id)}><Pencil size={15} /></button>
            <button className="icon-btn" title="Tirar trecho" aria-label={`Tirar trecho de ${p.session?.title ?? 'sessão'}`} onClick={() => remove(p)}><Trash2 size={15} /></button>
          </div>
          {editing === p.id && <RangeEditor from={p.page_from} to={p.page_to} max={material.pages ?? undefined} onCancel={() => setEditing(null)} onSave={async (a, b) => { await updateSessionPages(p.id, a, b); setEditing(null); await refresh(); }} />}
        </li>
      ))}
    </ul>
  );
}
