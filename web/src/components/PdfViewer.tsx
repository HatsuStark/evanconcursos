import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useRef, useState } from 'react';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Leitor de PDF dentro do app (PDF.js): abre na página pedida, navega, ajusta zoom; destaca o trecho da sessão.
export function PdfViewer({ url, page: initial, range }: { url: string; page: number; range?: [number, number] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(initial);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState('');

  // Baixa o PDF inteiro e abre pelos bytes (mais robusto que o carregamento em partes por URL).
  useEffect(() => {
    let cancelled = false, task: pdfjs.PDFDocumentLoadingTask | null = null;
    setDoc(null); setError('');
    fetch(url).then((r) => { if (!r.ok) throw new Error(`Não foi possível baixar o PDF (${r.status}).`); return r.arrayBuffer(); })
      .then((b) => { if (cancelled) return; task = pdfjs.getDocument({ data: new Uint8Array(b) }); return task.promise; })
      .then((d) => { if (d && !cancelled) setDoc(d); }, (e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; void task?.destroy(); };
  }, [url]);
  useEffect(() => { setPage(initial); }, [initial]);
  // A página acompanha a largura disponível (janela redimensionada ou entrada no modo foco).
  const [resized, setResized] = useState(0);
  useEffect(() => {
    const onResize = () => setResized((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!doc || !canvas.current || !box.current) return;
    let cancelled = false;
    let render: { cancel(): void; promise: Promise<void> } | null = null;
    void doc.getPage(Math.min(Math.max(1, page), doc.numPages)).then((p) => {
      if (cancelled || !canvas.current || !box.current) return;
      const base = p.getViewport({ scale: 1 }), fit = (box.current.clientWidth - 2) / base.width;
      const viewport = p.getViewport({ scale: fit * zoom * (window.devicePixelRatio || 1) });
      const c = canvas.current;
      c.width = viewport.width; c.height = viewport.height;
      c.style.width = `${viewport.width / (window.devicePixelRatio || 1)}px`;
      render = p.render({ canvas: c, viewport });
      render.promise.catch(() => {});
    });
    return () => { cancelled = true; render?.cancel(); };
  }, [doc, page, zoom, resized]);

  const total = doc?.numPages ?? 0;
  const inRange = range && page >= range[0] && page <= range[1];
  return (
    <div className="pdf">
      <div className="pdf-bar">
        <button className="icon-btn" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} aria-label="Página anterior"><ChevronLeft size={18} /></button>
        <label className="muted small">Página <input className="input pdf-page" type="number" min={1} max={total || undefined} value={page} onChange={(e) => setPage(Number(e.target.value) || 1)} /> de {total || '…'}</label>
        <button className="icon-btn" onClick={() => setPage(Math.min(total, page + 1))} disabled={!total || page >= total} aria-label="Próxima página"><ChevronRight size={18} /></button>
        <div style={{ flex: 1 }} />
        {range && <span className={'badge ' + (inRange ? 'lime' : '')}>{inRange ? 'Trecho da sessão' : `Sessão: p. ${range[0]}–${range[1]}`}</span>}
        <button className="icon-btn" onClick={() => setZoom(Math.max(0.5, zoom - 0.25))} aria-label="Diminuir zoom"><ZoomOut size={17} /></button>
        <button className="icon-btn" onClick={() => setZoom(Math.min(3, zoom + 0.25))} aria-label="Aumentar zoom"><ZoomIn size={17} /></button>
      </div>
      {error ? <p className="error">{error}</p> : <div className="pdf-canvas" ref={box}><canvas ref={canvas} /></div>}
    </div>
  );
}
