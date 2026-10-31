import { useQueryClient } from '@tanstack/react-query';
import { FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { readingMinutes, tooLongForSession } from '../../../shared/domain/pdf-reading.ts';
import { addSessionPages, deleteSessionPages, signedUrl, updateSessionPages, useMaterials, useSessionPages, type SessionPages } from '../lib/materials.ts';
import { useActivePlan } from '../lib/plans.ts';
import { PdfViewer } from './PdfViewer.tsx';
import { RangeEditor } from './RangeEditor.tsx';

// Aba "Meus PDFs" do modo estudo: só os trechos das apostilas do estudante que cobrem esta sessão.
// `minutes` é o tempo previsto para ler; sem ele (revisões, questões), não há aviso de trecho grande.
export function SessionMaterials({ sessionId, minutes = 0 }: { sessionId: string | null; minutes?: number }) {
  const qc = useQueryClient();
  const pages = useSessionPages(sessionId);
  const materials = useMaterials(useActivePlan().data?.plan.id);
  const [open, setOpen] = useState<{ id: string; url: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addTo, setAddTo] = useState('');
  const [error, setError] = useState('');
  async function show(p: SessionPages) {
    setError('');
    try { setOpen({ id: p.id, url: await signedUrl(p.material.storage_path) }); } catch (e) { setError((e as Error).message); }
  }
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['session-pages', sessionId] }), qc.invalidateQueries({ queryKey: ['material-pages'] })]);
  async function remove(p: SessionPages) {
    if (!confirm(`Tirar este trecho de "${p.material.title}" da sessão? A apostila continua em Meus materiais.`)) return;
    setError('');
    try { await deleteSessionPages(p.id); if (open?.id === p.id) setOpen(null); await refresh(); } catch (e) { setError((e as Error).message); }
  }
  // Com uma apostila só, já abre o trecho.
  const single = pages.data?.length === 1 ? pages.data[0] : undefined;
  useEffect(() => { if (single) void show(single); }, [single?.id]);

  if (!sessionId) return <div className="glass card muted">Esta tarefa não tem sessão de conteúdo.</div>;
  if (pages.isLoading) return <div className="spinner" />;
  const current = pages.data?.find((p) => p.id === open?.id);
  const library = materials.data ?? [];
  const target = library.find((m) => m.id === addTo) ?? library[0];
  return (
    <div className="grid" style={{ gap: 12 }}>
      {!pages.data?.length && (
        <div className="glass card muted">
          Nenhum trecho de apostila nesta sessão ainda. {library.length ? 'Se o assunto está em uma das suas apostilas, indique as páginas abaixo.' : <><Link to="/materiais">Envie seus PDFs</Link> e a IA indica as páginas de cada sessão.</>}
        </div>
      )}
      {pages.data?.map((p) => {
        const count = p.page_to - p.page_from + 1;
        return (
          <div key={p.id} className="glass card material-row">
            <FileText size={18} style={{ color: 'var(--cyan)' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>{p.material.title}</strong>
              <div className="muted small">Ler das páginas {p.page_from} a {p.page_to} · {count} {count === 1 ? 'página' : 'páginas'}</div>
              {tooLongForSession(count, minutes) && <div className="small" style={{ color: 'var(--orange)' }}>Trecho grande: cerca de {readingMinutes(count)} min de leitura, e esta tarefa prevê {minutes} min. Você pode dividir a leitura ou ajustar as páginas no lápis.</div>}
            </div>
            <button className="icon-btn" title="Ajustar páginas" aria-label={`Ajustar páginas de ${p.material.title}`} onClick={() => setEditing(editing === p.id ? null : p.id)}><Pencil size={15} /></button>
            <button className="icon-btn" title="Tirar trecho da sessão" aria-label={`Tirar trecho de ${p.material.title}`} onClick={() => remove(p)}><Trash2 size={15} /></button>
            {open?.id !== p.id && <button className="btn sm" onClick={() => show(p)}>Abrir trecho</button>}
            {editing === p.id && <RangeEditor from={p.page_from} to={p.page_to} max={p.material.pages ?? undefined} onCancel={() => setEditing(null)} onSave={async (a, b) => { await updateSessionPages(p.id, a, b); setEditing(null); await refresh(); }} />}
          </div>
        );
      })}
      {library.length > 0 && (adding ? (
        <div className="glass card material-row">
          {library.length > 1 && <label className="muted small" style={{ width: '100%' }}>Apostila <select className="input" value={target?.id} onChange={(e) => setAddTo(e.target.value)}>{library.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select></label>}
          {library.length === 1 && <strong style={{ width: '100%' }}>{target?.title}</strong>}
          <RangeEditor key={target?.id} max={target?.pages ?? undefined} onCancel={() => setAdding(false)} onSave={async (a, b) => { await addSessionPages(target!.id, sessionId, a, b); setAdding(false); await refresh(); }} />
        </div>
      ) : <div><button className="btn ghost sm" onClick={() => setAdding(true)}><Plus size={15} /> Adicionar trecho</button></div>)}
      {error && <p className="error">{error}</p>}
      {open && current && <div className="glass card"><PdfViewer key={open.id} url={open.url} range={[current.page_from, current.page_to]} storageKey={open.id} materialId={current.material.id} /></div>}
      {!!pages.data?.length && <p className="faint small" style={{ margin: 0 }}>Páginas indicadas pela IA a partir do texto da apostila. Se o trecho não bater com a sessão, ajuste no lápis: sua correção fica mesmo se mapear de novo.</p>}
    </div>
  );
}
