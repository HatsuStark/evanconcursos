import { ChevronLeft, ChevronRight, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Fontes padrão, mapas de caracteres e decodificadores que o PDF.js busca quando o arquivo precisa deles.
const ASSETS = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}`;
const READING_WIDTH = 820, GUTTER = 12, MIN_ZOOM = 0.5, MAX_ZOOM = 2.5, ZOOM_STEP = 0.1;
const MAX_CANVAS_PIXELS = 16_000_000;

function stored(key: string) { try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; } }
function store(key: string, value: number) { try { localStorage.setItem(key, String(value)); } catch { /* sem armazenamento */ } }

// Uma folha: desenha só perto da área visível e troca o desenho de uma vez, sem piscar ao mudar o zoom.
// O canvas tem múltiplo exato dos pixels da tela: qualquer diferença faz o navegador reamostrar e borra o texto.
function PdfPage({ doc, n, deviceWidth, dpr, firstRatio, onFrame }: { doc: pdfjs.PDFDocumentProxy; n: number; deviceWidth: number; dpr: number; firstRatio: number; onFrame: (n: number, el: HTMLDivElement | null) => void }) {
  const frame = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [ratio, setRatio] = useState(firstRatio);

  // Antes do efeito do leitor, que precisa das folhas para abrir na última página lida.
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setNear(!!e?.isIntersecting), { root: el.closest('.pdf-canvas'), rootMargin: '1200px 0px' });
    io.observe(el);
    onFrame(n, el);
    return () => { io.disconnect(); onFrame(n, null); };
  }, [n, onFrame]);

  useEffect(() => {
    if (!near) { frame.current?.replaceChildren(); return; }
    let cancelled = false;
    let task: { cancel(): void; promise: Promise<void> } | null = null;
    doc.getPage(n).then(async (p) => {
      if (cancelled) return;
      const base = p.getViewport({ scale: 1 }), r = base.height / base.width;
      setRatio(r);
      const dense = dpr < 2 ? 2 : 1, fit = Math.min(1, Math.sqrt(MAX_CANVAS_PIXELS / (deviceWidth * dense * deviceWidth * dense * r)));
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(deviceWidth * dense * fit);
      canvas.height = Math.ceil(canvas.width * r);
      task = p.render({ canvas, viewport: p.getViewport({ scale: canvas.width / base.width }) });
      await task.promise;
      if (!cancelled) frame.current?.replaceChildren(canvas);
    }).catch(() => { /* render cancelado: outro já está a caminho */ });
    return () => { cancelled = true; task?.cancel(); };
  }, [near, doc, n, deviceWidth, dpr]);

  const width = deviceWidth / dpr;
  return <div ref={frame} className="pdf-sheet" data-page={n} style={{ width, height: Math.ceil(deviceWidth * ratio) / dpr }} />;
}

// Leitor de PDF dentro do app (PDF.js): rolagem contínua, zoom e volta à última página lida.
// Com `range`, só as páginas do trecho ficam disponíveis.
export function PdfViewer({ url, range, storageKey }: { url: string; range?: [number, number]; storageKey: string }) {
  const box = useRef<HTMLDivElement>(null);
  const frames = useRef(new Map<number, HTMLDivElement>());
  const positionKey = `pdf-page:${storageKey}`;
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [firstRatio, setFirstRatio] = useState(1.414);
  const [page, setPage] = useState(() => stored(positionKey) || range?.[0] || 1);
  const anchor = useRef({ page, within: 0 }); // onde a leitura está, para não perder o lugar ao mudar o zoom
  const [draft, setDraft] = useState<string | null>(null);
  const [zoom, setZoom] = useState(() => stored('pdf-zoom') || 1);
  const [available, setAvailable] = useState(0);
  const [dpr, setDpr] = useState(window.devicePixelRatio || 1);
  const [error, setError] = useState('');

  const total = doc?.numPages ?? 0;
  const first = Math.min(range?.[0] ?? 1, total || Infinity), last = Math.min(range?.[1] ?? total, total);
  const clamp = (n: number) => Math.min(Math.max(first, n), Math.max(first, last));

  // Baixa o PDF inteiro e abre pelos bytes (mais robusto que o carregamento em partes por URL).
  useEffect(() => {
    let cancelled = false, task: pdfjs.PDFDocumentLoadingTask | null = null;
    setDoc(null); setError('');
    fetch(url).then((r) => { if (!r.ok) throw new Error(`Não foi possível baixar o PDF (${r.status}).`); return r.arrayBuffer(); })
      .then((b) => {
        if (cancelled) return;
        task = pdfjs.getDocument({ data: new Uint8Array(b), standardFontDataUrl: `${ASSETS}/standard_fonts/`, cMapUrl: `${ASSETS}/cmaps/`, cMapPacked: true, wasmUrl: `${ASSETS}/wasm/` });
        return task.promise;
      })
      .then(async (d) => {
        if (!d || cancelled) return;
        const v = (await d.getPage(1)).getViewport({ scale: 1 });
        if (!cancelled) { setFirstRatio(v.height / v.width); setDoc(d); }
      }, (e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; void task?.destroy(); };
  }, [url]);

  // A folha acompanha a largura disponível (janela redimensionada, modo foco ou zoom do navegador).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { setAvailable(el.clientWidth - 2 * GUTTER); setDpr(window.devicePixelRatio || 1); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const base = Math.min(available, READING_WIDTH);
  const deviceWidth = Math.floor(base * zoom * dpr);

  // Abre na última página lida e, depois de qualquer mudança de tamanho, volta ao mesmo ponto da leitura.
  useLayoutEffect(() => {
    if (!doc || !box.current || deviceWidth <= 0) return;
    const target = clamp(anchor.current.page);
    const f = frames.current.get(target);
    if (f) box.current.scrollTop = f.offsetTop + anchor.current.within * f.offsetHeight - GUTTER;
    setPage(target);
  }, [doc, deviceWidth, first, last]);

  useEffect(() => { if (doc) store(positionKey, page); }, [doc, page, positionKey]);
  useEffect(() => { store('pdf-zoom', zoom); }, [zoom]);

  function onScroll() {
    const el = box.current;
    if (!el) return;
    const line = el.scrollTop + el.clientHeight / 3;
    for (let n = first; n <= last; n++) {
      const f = frames.current.get(n);
      if (f && (n === last || line < f.offsetTop + f.offsetHeight + GUTTER)) {
        anchor.current = { page: n, within: (el.scrollTop + GUTTER - f.offsetTop) / f.offsetHeight };
        setPage(n);
        return;
      }
    }
  }
  function goTo(n: number) {
    const target = clamp(n), f = frames.current.get(target);
    anchor.current = { page: target, within: 0 };
    setPage(target);
    if (f && box.current) box.current.scrollTop = f.offsetTop - GUTTER;
  }
  function commitDraft() {
    if (draft !== null && Number(draft)) goTo(Number(draft));
    setDraft(null);
  }
  const zoomTo = (z: number) => setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100)));
  const onFrame = useRef((n: number, el: HTMLDivElement | null) => { if (el) frames.current.set(n, el); else frames.current.delete(n); }).current;

  return (
    <div className="pdf">
      <div className="pdf-bar">
        <button className="icon-btn" onClick={() => goTo(page - 1)} disabled={!total || page <= first} aria-label="Página anterior"><ChevronLeft size={18} /></button>
        <label className="muted small">Página <input className="input pdf-page" type="number" min={first} max={last || undefined} value={draft ?? page} onChange={(e) => setDraft(e.target.value)} onBlur={commitDraft} onKeyDown={(e) => { if (e.key === 'Enter') commitDraft(); }} /> {range ? `(trecho: ${first} a ${last || '…'})` : `de ${total || '…'}`}</label>
        <button className="icon-btn" onClick={() => goTo(page + 1)} disabled={!total || page >= last} aria-label="Próxima página"><ChevronRight size={18} /></button>
        <div style={{ flex: 1 }} />
        <button className="icon-btn" onClick={() => zoomTo(zoom - ZOOM_STEP)} disabled={zoom <= MIN_ZOOM} aria-label="Diminuir zoom"><ZoomOut size={17} /></button>
        <button className="btn ghost sm" onClick={() => zoomTo(1)} title="Voltar ao tamanho de leitura">{Math.round(zoom * 100)}%</button>
        <button className="icon-btn" onClick={() => zoomTo(zoom + ZOOM_STEP)} disabled={zoom >= MAX_ZOOM} aria-label="Aumentar zoom"><ZoomIn size={17} /></button>
        <button className="icon-btn" onClick={() => base > 0 && zoomTo(available / base)} aria-label="Ajustar à largura" title="Ajustar à largura"><Maximize2 size={16} /></button>
      </div>
      {error ? <p className="error">{error}</p> : (
        <div className="pdf-canvas" ref={box} onScroll={onScroll} tabIndex={0} aria-label="Páginas da apostila">
          {!doc && <div className="spinner" />}
          {doc && deviceWidth > 0 && last >= first && (
            <div className="pdf-pages">
              {Array.from({ length: last - first + 1 }, (_, i) => first + i).map((n) => <PdfPage key={n} doc={doc} n={n} deviceWidth={deviceWidth} dpr={dpr} firstRatio={firstRatio} onFrame={onFrame} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
