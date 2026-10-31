import { useQueryClient } from '@tanstack/react-query';
import { FileText, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { signedUrl, updateSessionPages, useSessionPages, type SessionPages } from '../lib/materials.ts';
import { PdfViewer } from './PdfViewer.tsx';

function RangeEditor({ p, onDone }: { p: SessionPages; onDone: (changed: boolean) => void }) {
  const [from, setFrom] = useState(String(p.page_from)), [to, setTo] = useState(String(p.page_to));
  const [error, setError] = useState('');
  const max = p.material.pages ?? undefined;
  async function save() {
    const a = Number(from), b = Number(to);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < a || (max && b > max)) { setError(max ? `Use páginas de 1 a ${max}, com a inicial antes da final.` : 'A página inicial precisa vir antes da final.'); return; }
    try { await updateSessionPages(p.id, a, b); onDone(true); } catch (e) { setError((e as Error).message); }
  }
  return (
    <div className="pdf-range" style={{ width: '100%' }}>
      <label className="muted small">Da página <input className="input pdf-page" type="number" min={1} max={max} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      <label className="muted small">até <input className="input pdf-page" type="number" min={1} max={max} value={to} onChange={(e) => setTo(e.target.value)} /></label>
      <button className="btn sm" onClick={save}>Salvar</button>
      <button className="btn ghost sm" onClick={() => onDone(false)}>Cancelar</button>
      {error && <p className="error" role="alert" style={{ margin: 0, width: '100%' }}>{error}</p>}
    </div>
  );
}

// Aba "Meus PDFs" do modo estudo: só os trechos das apostilas do estudante que cobrem esta sessão.
export function SessionMaterials({ sessionId }: { sessionId: string | null }) {
  const qc = useQueryClient();
  const pages = useSessionPages(sessionId);
  const [open, setOpen] = useState<{ id: string; url: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState('');
  async function show(p: SessionPages) {
    setError('');
    try { setOpen({ id: p.id, url: await signedUrl(p.material.storage_path) }); } catch (e) { setError((e as Error).message); }
  }
  // Com uma apostila só, já abre o trecho.
  const single = pages.data?.length === 1 ? pages.data[0] : undefined;
  useEffect(() => { if (single) void show(single); }, [single?.id]);

  if (!sessionId) return <div className="glass card muted">Esta tarefa não tem sessão de conteúdo.</div>;
  if (pages.isLoading) return <div className="spinner" />;
  if (!pages.data?.length) return <div className="glass card muted">Nenhuma apostila sua cobre esta sessão ainda. <Link to="/materiais">Envie seus PDFs</Link> e a IA indica as páginas de cada sessão.</div>;
  const current = pages.data.find((p) => p.id === open?.id);
  return (
    <div className="grid" style={{ gap: 12 }}>
      {pages.data.map((p) => (
        <div key={p.id} className="glass card material-row">
          <FileText size={18} style={{ color: 'var(--cyan)' }} />
          <div style={{ flex: 1, minWidth: 0 }}><strong>{p.material.title}</strong><div className="muted small">Ler das páginas {p.page_from} a {p.page_to} · {p.page_to - p.page_from + 1} {p.page_to === p.page_from ? 'página' : 'páginas'}</div></div>
          <button className="icon-btn" title="Ajustar páginas" aria-label={`Ajustar páginas de ${p.material.title}`} onClick={() => setEditing(editing === p.id ? null : p.id)}><Pencil size={15} /></button>
          {open?.id !== p.id && <button className="btn sm" onClick={() => show(p)}>Abrir trecho</button>}
          {editing === p.id && <RangeEditor p={p} onDone={async (changed) => { setEditing(null); if (changed) await qc.invalidateQueries({ queryKey: ['session-pages', sessionId] }); }} />}
        </div>
      ))}
      {error && <p className="error">{error}</p>}
      {open && current && <div className="glass card"><PdfViewer key={open.id} url={open.url} range={[current.page_from, current.page_to]} storageKey={open.id} /></div>}
      <p className="faint small" style={{ margin: 0 }}>Páginas indicadas pela IA a partir do texto da apostila. Se o trecho não bater com a sessão, ajuste no lápis.</p>
    </div>
  );
}
