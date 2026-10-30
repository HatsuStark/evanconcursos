import { useQueryClient } from '@tanstack/react-query';
import { FileUp, Lock, RefreshCw, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { PdfViewer } from '../components/PdfViewer.tsx';
import { Shell } from '../components/Shell.tsx';
import { deleteMaterial, remapMaterial, signedUrl, uploadMaterial, useMaterials, type Material } from '../lib/materials.ts';
import { useActivePlan } from '../lib/plans.ts';

const STATUS: Record<Material['status'], { label: string; cls: string }> = {
  uploaded: { label: 'Enviado', cls: '' }, mapping: { label: 'Mapeando…', cls: 'cyan' }, mapped: { label: 'Mapeado', cls: 'lime' }, failed: { label: 'Falhou', cls: 'orange' },
};

// Biblioteca pessoal: apostilas do estudante, mapeadas pela IA para as sessões do cronograma.
export function MaterialsPage() {
  const qc = useQueryClient();
  const active = useActivePlan();
  const planId = active.data?.plan.id;
  const materials = useMaterials(planId);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState<{ m: Material; url: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['materials'] });

  async function pick(file: File | undefined) {
    if (!file || !planId) return;
    setBusy(true); setError('');
    try { await uploadMaterial(file, planId); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  async function act(fn: () => Promise<unknown>) { setError(''); try { await fn(); await refresh(); } catch (e) { setError((e as Error).message); } }

  return (
    <Shell title="Meus materiais" subtitle="Envie suas apostilas em PDF. A IA indica em que páginas está cada sessão do cronograma.">
      {!active.isLoading && !planId ? <div className="glass card muted">Monte o cronograma primeiro: o mapeamento liga as páginas às sessões dele.</div> : (
        <div className="grid" style={{ gap: 16 }}>
          <div className="dropzone" role="button" tabIndex={0} onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void pick(e.dataTransfer.files[0]); }}>
            <FileUp />
            <strong>{busy ? 'Enviando…' : 'Arraste a apostila (PDF) ou clique para escolher'}</strong>
            <span className="muted small">Até 50 MB · PDFs escaneados (só imagem) não podem ser mapeados</span>
            <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => pick(e.target.files?.[0])} />
          </div>
          <span className="chip faint"><Lock /> Seus PDFs ficam numa pasta privada; só você acessa.</span>
          {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
          {materials.data?.map((m) => (
            <div key={m.id} className="glass card material-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{m.title}</strong>
                <div className="muted small">{m.pages ? `${m.pages} páginas · ` : ''}{(m.size_bytes / 1024 / 1024).toFixed(1)} MB{m.status_detail ? ` · ${m.status_detail}` : ''}</div>
              </div>
              <span className={'badge ' + STATUS[m.status].cls}>{STATUS[m.status].label}</span>
              <button className="btn ghost sm" onClick={async () => setViewing({ m, url: await signedUrl(m.storage_path) })}>Abrir</button>
              {m.status !== 'mapping' && <button className="icon-btn" title="Mapear de novo" aria-label="Mapear de novo" onClick={() => act(() => remapMaterial(m.id))}><RefreshCw size={16} /></button>}
              <button className="icon-btn" title="Apagar" aria-label={`Apagar ${m.title}`} onClick={() => confirm(`Apagar "${m.title}"?`) && act(() => deleteMaterial(m))}><Trash2 size={16} /></button>
            </div>
          ))}
          {viewing && <div className="glass card"><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}><strong>{viewing.m.title}</strong><button className="btn ghost sm" onClick={() => setViewing(null)}>Fechar</button></div><PdfViewer url={viewing.url} page={1} /></div>}
        </div>
      )}
    </Shell>
  );
}
