import { FileText } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { signedUrl, useSessionPages, type SessionPages } from '../lib/materials.ts';
import { PdfViewer } from './PdfViewer.tsx';

// Aba "Meus PDFs" do modo estudo: trechos das apostilas do estudante que cobrem esta sessão.
export function SessionMaterials({ sessionId }: { sessionId: string | null }) {
  const pages = useSessionPages(sessionId);
  const [open, setOpen] = useState<{ p: SessionPages; url: string } | null>(null);
  const [error, setError] = useState('');
  if (!sessionId) return <div className="glass card muted">Esta tarefa não tem sessão de conteúdo.</div>;
  if (pages.isLoading) return <div className="spinner" />;
  if (!pages.data?.length) return <div className="glass card muted">Nenhuma apostila sua cobre esta sessão ainda. <Link to="/materiais">Envie seus PDFs</Link> e a IA indica as páginas de cada sessão.</div>;
  return (
    <div className="grid" style={{ gap: 12 }}>
      {pages.data.map((p) => (
        <div key={p.id} className="glass card material-row">
          <FileText size={18} style={{ color: 'var(--cyan)' }} />
          <div style={{ flex: 1 }}><strong>{p.material.title}</strong><div className="muted small">páginas {p.page_from}–{p.page_to}</div></div>
          <button className="btn sm" onClick={async () => { try { setOpen({ p, url: await signedUrl(p.material.storage_path) }); } catch (e) { setError((e as Error).message); } }}>Abrir na página {p.page_from}</button>
        </div>
      ))}
      {error && <p className="error">{error}</p>}
      {open && <div className="glass card"><PdfViewer url={open.url} page={open.p.page_from} range={[open.p.page_from, open.p.page_to]} /></div>}
      <p className="faint small" style={{ margin: 0 }}>Páginas indicadas pela IA a partir do texto da apostila; podem ter pequenas variações.</p>
    </div>
  );
}
