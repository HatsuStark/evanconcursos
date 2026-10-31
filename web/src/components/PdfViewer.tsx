import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Copy, Highlighter, Maximize2, Pencil, ZoomIn, ZoomOut } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { mergeRects, type MarkRect } from '../../../shared/domain/pdf-reading.ts';
import { addMaterialNotes, deleteMaterialNote, updateMaterialNote, useMaterialNotes, type MaterialNote, type NoteColor } from '../lib/materials.ts';
import { openPdf } from '../lib/pdfjs.ts';
import { NOTE_COLORS, PdfNotes } from './PdfNotes.tsx';

const READING_WIDTH = 820, GUTTER = 12, MIN_ZOOM = 0.5, MAX_ZOOM = 2.5, ZOOM_STEP = 0.1;
const MAX_CANVAS_PIXELS = 16_000_000;

function stored(key: string) { try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; } }
function store(key: string, value: number) { try { localStorage.setItem(key, String(value)); } catch { /* sem armazenamento */ } }

interface SelectedPart { page: number; rects: MarkRect[]; quote: string }
interface Selected { x: number; y: number; text: string; parts: SelectedPart[] }

// Partes da seleção em cada folha, em frações da página. Vai de texto em texto porque os retângulos da
// seleção inteira incluem a camada de texto completa quando ela atravessa uma página.
function selectedParts(range: Range, frames: Map<number, HTMLDivElement>): SelectedPart[] {
  const parts: SelectedPart[] = [], piece = document.createRange();
  for (const [page, frame] of [...frames].sort((a, b) => a[0] - b[0])) {
    const layer = frame.querySelector('.textLayer');
    if (!layer || !range.intersectsNode(layer)) continue;
    const box = frame.getBoundingClientRect(), rects: MarkRect[] = [];
    let quote = '', previous: DOMRect | null = null;
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!range.intersectsNode(n) || !n.nodeValue?.trim()) continue;
      piece.selectNodeContents(n);
      if (n === range.startContainer) piece.setStart(n, range.startOffset);
      if (n === range.endContainer) piece.setEnd(n, range.endOffset);
      const r = piece.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      rects.push([(r.left - box.left) / box.width, (r.top - box.top) / box.height, r.width / box.width, r.height / box.height]);
      // O PDF pode quebrar uma palavra em dois pedaços: só há espaço se mudou de linha ou se há vão entre eles.
      const joined: boolean = !!previous && Math.abs(previous.top - r.top) < r.height / 2 && r.left - previous.right < r.height * 0.12;
      quote += (joined ? '' : ' ') + piece.toString();
      previous = r;
    }
    if (rects.length) parts.push({ page, rects: mergeRects(rects).slice(0, 200), quote: quote.normalize('NFKC').replace(/\s+/g, ' ').trim() });
  }
  return parts;
}

// Uma folha: desenha só perto da área visível e troca o desenho de uma vez, sem piscar ao mudar o zoom.
// O canvas tem múltiplo exato dos pixels da tela: qualquer diferença faz o navegador reamostrar e borra o texto.
// Por cima dele, as marcações e a camada de texto invisível que permite selecionar e copiar.
function PdfPage({ doc, n, deviceWidth, dpr, firstRatio, marks, onFrame }: { doc: pdfjs.PDFDocumentProxy; n: number; deviceWidth: number; dpr: number; firstRatio: number; marks: MaterialNote[]; onFrame: (n: number, el: HTMLDivElement | null) => void }) {
  const frame = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const words = useRef<HTMLDivElement>(null);
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
    if (!near) { art.current?.replaceChildren(); words.current?.replaceChildren(); return; }
    let cancelled = false;
    let task: { cancel(): void; promise: Promise<void> } | null = null;
    let text: pdfjs.TextLayer | null = null;
    doc.getPage(n).then(async (p) => {
      if (cancelled) return;
      const base = p.getViewport({ scale: 1 }), r = base.height / base.width;
      setRatio(r);
      const dense = dpr < 2 ? 2 : 1, fit = Math.min(1, Math.sqrt(MAX_CANVAS_PIXELS / (deviceWidth * dense * deviceWidth * dense * r)));
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(deviceWidth * dense * fit);
      canvas.height = Math.ceil(canvas.width * r);
      task = p.render({ canvas, viewport: p.getViewport({ scale: canvas.width / base.width }) });

      const scale = deviceWidth / dpr / base.width;
      const layer = document.createElement('div');
      layer.className = 'textLayer';
      layer.style.setProperty('--total-scale-factor', String(scale));
      layer.addEventListener('mousedown', () => {
        layer.classList.add('selecting');
        document.addEventListener('mouseup', () => layer.classList.remove('selecting'), { once: true });
      });
      text = new pdfjs.TextLayer({ textContentSource: p.streamTextContent({ includeMarkedContent: true, disableNormalization: true }), container: layer, viewport: p.getViewport({ scale }) });
      const wordsReady = text.render();

      await task.promise;
      if (!cancelled) art.current?.replaceChildren(canvas);
      await wordsReady;
      const end = document.createElement('div');
      end.className = 'endOfContent';
      layer.append(end);
      if (!cancelled) words.current?.replaceChildren(layer);
    }).catch(() => { /* render cancelado: outro já está a caminho */ });
    return () => { cancelled = true; task?.cancel(); text?.cancel(); };
  }, [near, doc, n, deviceWidth, dpr]);

  const width = deviceWidth / dpr;
  return (
    <div ref={frame} className="pdf-sheet" data-page={n} style={{ width, height: Math.ceil(deviceWidth * ratio) / dpr }}>
      <div ref={art} className="pdf-art" />
      <div className="pdf-marks">
        {marks.flatMap((m) => m.rects.map(([x, y, w, h], i) => <span key={`${m.id}-${i}`} className={`pdf-mark ${m.color}`} style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }} />))}
      </div>
      <div ref={words} className="pdf-words" />
    </div>
  );
}

// Leitor de PDF dentro do app (PDF.js): rolagem contínua, zoom, volta à última página lida, seleção de
// texto, marcações e anotações. Com `range`, só as páginas do trecho ficam disponíveis.
export function PdfViewer({ url, range, storageKey, materialId }: { url: string; range?: [number, number]; storageKey: string; materialId: string }) {
  const qc = useQueryClient();
  const root = useRef<HTMLDivElement>(null);
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
  const [selected, setSelected] = useState<Selected | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [focusNote, setFocusNote] = useState<string | null>(null);
  const [noteError, setNoteError] = useState('');
  const allNotes = useMaterialNotes(materialId);

  const total = doc?.numPages ?? 0;
  const first = Math.min(range?.[0] ?? 1, total || Infinity), last = Math.min(range?.[1] ?? total, total);
  const clamp = (n: number) => Math.min(Math.max(first, n), Math.max(first, last));
  const notes = (allNotes.data ?? []).filter((n) => n.page >= first && (!last || n.page <= last));

  // Baixa o PDF inteiro e abre pelos bytes (mais robusto que o carregamento em partes por URL).
  useEffect(() => {
    let cancelled = false, task: pdfjs.PDFDocumentLoadingTask | null = null;
    setDoc(null); setError('');
    fetch(url).then((r) => { if (!r.ok) throw new Error(`Não foi possível baixar o PDF (${r.status}).`); return r.arrayBuffer(); })
      .then((b) => {
        if (cancelled) return;
        task = openPdf(new Uint8Array(b));
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

  // Barra sobre o texto selecionado, posicionada dentro do leitor.
  function readSelection() {
    const s = document.getSelection();
    if (!s || s.isCollapsed || !root.current || !box.current?.contains(s.anchorNode)) { setSelected(null); return; }
    const range = s.getRangeAt(0), parts = selectedParts(range, frames.current);
    if (!parts.length) { setSelected(null); return; }
    const r = range.getBoundingClientRect(), o = root.current.getBoundingClientRect(), view = box.current.getBoundingClientRect();
    const top = Math.max(r.top, view.top) - o.top;
    setSelected({ x: Math.min(Math.max(120, r.left + r.width / 2 - o.left), o.width - 120), y: top < 48 ? top + 8 : top - 44, text: s.toString().normalize('NFKC'), parts });
  }
  useEffect(() => {
    document.addEventListener('selectionchange', readSelection);
    return () => document.removeEventListener('selectionchange', readSelection);
  }, []);

  function onScroll() {
    const el = box.current;
    if (!el) return;
    if (selected) readSelection();
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

  async function changeNotes(fn: () => Promise<unknown>) {
    setNoteError('');
    try { await fn(); await qc.invalidateQueries({ queryKey: ['material-notes', materialId] }); } catch (e) { setNoteError((e as Error).message); }
  }
  async function mark(color: NoteColor, annotate: boolean) {
    if (!selected) return;
    const parts = selected.parts;
    document.getSelection()?.removeAllRanges();
    await changeNotes(async () => {
      const id = await addMaterialNotes(materialId, parts, color);
      if (annotate) { setFocusNote(id); setShowNotes(true); }
    });
  }
  async function copy() {
    if (!selected) return;
    try { await navigator.clipboard.writeText(selected.text); } catch { setNoteError('O navegador não deixou copiar. Use Ctrl+C.'); }
  }

  return (
    <div className="pdf" ref={root}>
      <div className="pdf-bar">
        <button className="icon-btn" onClick={() => goTo(page - 1)} disabled={!total || page <= first} aria-label="Página anterior"><ChevronLeft size={18} /></button>
        <label className="muted small">Página <input className="input pdf-page" type="number" min={first} max={last || undefined} value={draft ?? page} onChange={(e) => setDraft(e.target.value)} onBlur={commitDraft} onKeyDown={(e) => { if (e.key === 'Enter') commitDraft(); }} /> {range ? `(trecho: ${first} a ${last || '…'})` : `de ${total || '…'}`}</label>
        <button className="icon-btn" onClick={() => goTo(page + 1)} disabled={!total || page >= last} aria-label="Próxima página"><ChevronRight size={18} /></button>
        <div style={{ flex: 1 }} />
        <button className="btn ghost sm" aria-pressed={showNotes} onClick={() => setShowNotes(!showNotes)}><Highlighter size={15} /> Anotações{notes.length ? ` (${notes.length})` : ''}</button>
        <button className="icon-btn" onClick={() => zoomTo(zoom - ZOOM_STEP)} disabled={zoom <= MIN_ZOOM} aria-label="Diminuir zoom"><ZoomOut size={17} /></button>
        <button className="btn ghost sm" onClick={() => zoomTo(1)} title="Voltar ao tamanho de leitura">{Math.round(zoom * 100)}%</button>
        <button className="icon-btn" onClick={() => zoomTo(zoom + ZOOM_STEP)} disabled={zoom >= MAX_ZOOM} aria-label="Aumentar zoom"><ZoomIn size={17} /></button>
        <button className="icon-btn" onClick={() => base > 0 && zoomTo(available / base)} aria-label="Ajustar à largura" title="Ajustar à largura"><Maximize2 size={16} /></button>
      </div>
      {noteError && <p className="error" role="alert" style={{ margin: 0 }}>{noteError}</p>}
      {showNotes && <PdfNotes notes={notes} focusId={focusNote} onGo={goTo}
        onChange={(id, patch) => changeNotes(() => updateMaterialNote(id, patch))}
        onDelete={(id) => changeNotes(() => deleteMaterialNote(id))} />}
      {selected && (
        <div className="pdf-select-bar" style={{ left: selected.x, top: selected.y }} onMouseDown={(e) => e.preventDefault()}>
          {NOTE_COLORS.map((c) => <button key={c.id} className={`pdf-swatch ${c.id}`} aria-label={`Marcar de ${c.label}`} title={`Marcar de ${c.label}`} onClick={() => mark(c.id, false)} />)}
          <button className="btn ghost sm" onClick={() => mark('yellow', true)}><Pencil size={14} /> Anotar</button>
          <button className="btn ghost sm" onClick={copy}><Copy size={14} /> Copiar</button>
        </div>
      )}
      {error ? <p className="error">{error}</p> : (
        <div className="pdf-canvas" ref={box} onScroll={onScroll} tabIndex={0} aria-label="Páginas da apostila">
          {!doc && <div className="spinner" />}
          {doc && deviceWidth > 0 && last >= first && (
            <div className="pdf-pages">
              {Array.from({ length: last - first + 1 }, (_, i) => first + i).map((n) => <PdfPage key={n} doc={doc} n={n} deviceWidth={deviceWidth} dpr={dpr} firstRatio={firstRatio} marks={notes.filter((x) => x.page === n)} onFrame={onFrame} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
