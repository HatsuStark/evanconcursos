import { BookA, Search, Sparkles, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { findExact, searchGlossary, type GlossaryEntry } from '../../../shared/glossary/search.ts';
import { askGlossaryAi, DICT_EVENT, loadGlossary, lookupInDictionary, pushRecent, readDictPos, readRecent, saveDictPos, type DictPos } from '../lib/glossary.ts';

type Shown = { entry: GlossaryEntry; ai: boolean };
const DRAG_THRESHOLD = 6;
const bottomGap = () => (window.innerWidth <= 720 ? 84 : 12); // no celular, acima da barra inferior

// Dicionário de termos: botão translúcido preso a uma borda da tela (esquerda por padrão, no meio). O estudante arrasta
// para onde quiser; ao soltar, gruda na borda mais próxima, na altura escolhida (salvo no navegador). Busca no glossário próprio
// enquanto digita; o que não estiver lá pode ser perguntado à IA (cache compartilhado na função "glossary").
export function DictionaryButton() {
  const [open, setOpen] = useState(false);
  const [glossary, setGlossary] = useState<GlossaryEntry[] | null>(null);
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState<Shown | null>(null);
  const [ai, setAi] = useState<{ status: 'idle' | 'loading' | 'missing' | 'error'; error?: string }>({ status: 'idle' });
  const [recent, setRecent] = useState<string[]>(readRecent);
  const pending = useRef<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<DictPos>(readDictPos);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [fitTop, setFitTop] = useState<number | null>(null);
  const press = useRef<{ id: number; dx: number; dy: number; sx: number; sy: number; moved: boolean } | null>(null);
  const draggedAt = useRef(0); // o clique que vem logo após soltar o arraste não abre o painel

  // Painel aberto perto do topo ou do fim da tela: desloca o conjunto para caber inteiro.
  useLayoutEffect(() => {
    const el = box.current;
    if (!open || !el) { setFitTop(null); return; }
    const fit = () => {
      const h = el.offsetHeight, want = pos.y * window.innerHeight;
      const top = Math.min(Math.max(want, h / 2 + 12), window.innerHeight - h / 2 - bottomGap());
      setFitTop(Math.abs(top - want) < 1 ? null : top);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener('resize', fit);
    return () => { ro.disconnect(); window.removeEventListener('resize', fit); };
  }, [open, pos]);

  function onPointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    press.current = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - (r.top + r.height / 2), sx: e.clientX, sy: e.clientY, moved: false };
  }
  function onPointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    if (!p.moved) {
      if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < DRAG_THRESHOLD) return;
      p.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      setOpen(false);
    }
    setDrag({ x: e.clientX - p.dx, y: e.clientY - p.dy });
  }
  function onPointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
    const p = press.current;
    press.current = null;
    if (!p?.moved) return;
    draggedAt.current = Date.now();
    const h = window.innerHeight, min = 56 / h, max = 1 - (bottomGap() + 40) / h;
    const next: DictPos = { side: e.clientX < window.innerWidth / 2 ? 'left' : 'right', y: Math.min(Math.max((e.clientY - p.dy) / h, min), max) };
    setDrag(null); setPos(next); saveDictPos(next);
  }

  const results = useMemo(() => (glossary && !shown ? searchGlossary(glossary, query) : []), [glossary, query, shown]);

  useEffect(() => {
    if (open && !glossary) loadGlossary().then(setGlossary).catch(() => setGlossary([]));
  }, [open, glossary]);

  function show(entry: GlossaryEntry, fromAi: boolean) {
    setShown({ entry, ai: fromAi });
    setQuery(entry.term);
    setAi({ status: 'idle' });
    setRecent(pushRecent(entry.term));
  }
  // Termo vindo de fora (seleção, "veja também", recentes): abre a definição se estiver no glossário.
  function lookup(term: string, list = glossary) {
    if (!list) { pending.current = term; return; }
    const hit = findExact(list, term);
    if (hit) { show(hit, false); return; }
    setShown(null); setQuery(term); setAi({ status: 'idle' });
  }
  useEffect(() => {
    if (glossary && pending.current) { const t = pending.current; pending.current = null; lookup(t, glossary); }
  }, [glossary]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onLookup = (e: Event) => { setOpen(true); lookup(String((e as CustomEvent).detail ?? '')); };
    window.addEventListener(DICT_EVENT, onLookup);
    return () => window.removeEventListener(DICT_EVENT, onLookup);
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown); };
  }, [open]);

  async function askAi() {
    const term = query.trim();
    if (term.length < 2) return;
    setAi({ status: 'loading' });
    try {
      const entry = await askGlossaryAi(term);
      if (entry) show(entry, true); else setAi({ status: 'missing' });
    } catch (e) { setAi({ status: 'error', error: (e as Error).message || 'Não foi possível consultar agora.' }); }
  }

  function type(v: string) { setQuery(v); setShown(null); setAi({ status: 'idle' }); }
  function onEnter() {
    if (shown) return;
    if (results[0]) show(results[0], false); else void askAi();
  }

  const typed = query.trim().length >= 2;
  return (
    <>
    <div className={'dict' + (open ? ' open' : '') + (pos.side === 'right' && !drag ? ' right' : '') + (drag ? ' dragging' : '')} ref={box}
      style={drag ? { left: drag.x, right: 'auto', top: drag.y } : { top: fitTop ?? `${pos.y * 100}%` }}>
      <button className="dict-fab" aria-label="Dicionário de termos (arraste para mudar de lugar)" aria-expanded={open}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { press.current = null; setDrag(null); }}
        onClick={() => { if (Date.now() - draggedAt.current > 350) setOpen(!open); }}>
        <BookA size={19} />
        <span className="dict-tip" aria-hidden>Dicionário de termos</span>
      </button>
      {open && (
        <div className="dict-panel" role="dialog" aria-label="Dicionário de termos">
          <div className="dict-head">
            <BookA size={17} /> <strong>Dicionário</strong>
            <button className="icon-btn" style={{ width: 28, height: 28, marginLeft: 'auto' }} onClick={() => setOpen(false)} aria-label="Fechar"><X size={15} /></button>
          </div>
          <label className="dict-search">
            <Search size={15} />
            <input ref={input} autoFocus value={query} onChange={(e) => type(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onEnter(); }}
              placeholder="Digite um termo" aria-label="Termo" maxLength={80} enterKeyHint="search" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            {query && <button className="dict-clear" onClick={() => { type(''); input.current?.focus(); }} aria-label="Limpar"><X size={13} /></button>}
          </label>

          {shown ? (
            <div className="dict-entry">
              <div className="dict-term"><strong>{shown.entry.term}</strong><span className="dict-area">{shown.entry.area}</span></div>
              <p>{shown.entry.definition}</p>
              {shown.entry.note && <p className="dict-note">{shown.entry.note}</p>}
              {!!shown.entry.see?.length && (
                <div className="dict-see">Veja também: {shown.entry.see.map((s, i) => (
                  <span key={s}>{i > 0 && ' · '}<button onClick={() => lookup(s)}>{s}</button></span>
                ))}</div>
              )}
              {shown.ai && <span className="dict-ai-flag"><Sparkles size={12} /> Definição gerada por IA. Confira na fonte em caso de dúvida.</span>}
            </div>
          ) : !glossary ? (
            <div className="spinner" style={{ margin: '8px auto' }} />
          ) : typed ? (
            <>
              {results.length > 0 && (
                <ul className="dict-results">
                  {results.map((r) => <li key={r.term}><button onClick={() => show(r, false)}>{r.term} <small>· {r.area}</small></button></li>)}
                </ul>
              )}
              {!results.length && <p className="faint small" style={{ margin: 0 }}>“{query.trim()}” não está no glossário.</p>}
              {ai.status === 'missing' && <p className="faint small" style={{ margin: 0 }}>A IA também não reconheceu esse termo. Confira a grafia.</p>}
              {ai.status === 'error' && <p className="error small" style={{ margin: 0 }}>{ai.error}</p>}
              {ai.status !== 'missing' && (
                <button className={'btn sm' + (results.length ? ' ghost' : '')} onClick={askAi} disabled={ai.status === 'loading'}>
                  <Sparkles size={14} /> {ai.status === 'loading' ? 'Consultando…' : results.length ? `Perguntar à IA sobre “${query.trim()}”` : 'Perguntar à IA'}
                </button>
              )}
            </>
          ) : recent.length > 0 ? (
            <div className="dict-recent"><span className="faint small">Recentes:</span>{recent.map((t) => <button key={t} className="dict-chip" onClick={() => lookup(t)}>{t}</button>)}</div>
          ) : (
            <p className="faint small" style={{ margin: 0 }}>Termos jurídicos, técnicos e expressões em latim. Dica: selecione uma palavra no texto para consultar.</p>
          )}
        </div>
      )}
    </div>
    {/* Fora do .dict: o transform dele mudaria a referência do position: fixed. */}
    <SelectionLookup />
    </>
  );
}

// Opção "Consultar no dicionário" junto ao texto selecionado (não abre sozinho). Fora de campos de digitação, do
// próprio balão e do leitor de PDF (que tem a própria barra de seleção, com o mesmo botão).
function SelectionLookup() {
  const [pick, setPick] = useState<{ x: number; y: number; text: string } | null>(null);
  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    let frame = 0;
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const s = document.getSelection();
        const text = s && !s.isCollapsed ? s.toString().replace(/\s+/g, ' ').trim() : '';
        const node = s?.anchorNode, el = node instanceof Element ? node : node?.parentElement;
        if (!s || text.length < 2 || text.length > 60 || text.split(' ').length > 6 || !/\p{L}/u.test(text)
          || el?.closest('input, textarea, [contenteditable="true"], .pdf, .dict')) { setPick(null); return; }
        const r = s.getRangeAt(0).getBoundingClientRect();
        if (!r.width && !r.height) { setPick(null); return; }
        const x = Math.min(Math.max(r.left + r.width / 2, 100), window.innerWidth - 100);
        // No celular o menu do sistema fica acima da seleção: a opção vai abaixo.
        const y = coarse || r.top < 52 ? r.bottom + 10 : r.top - 42;
        setPick({ x, y, text });
      });
    };
    document.addEventListener('selectionchange', read);
    window.addEventListener('scroll', read, true);
    window.addEventListener('resize', read);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('selectionchange', read); window.removeEventListener('scroll', read, true); window.removeEventListener('resize', read); };
  }, []);
  if (!pick) return null;
  return (
    <button className="dict-pick" style={{ left: pick.x, top: pick.y }} onMouseDown={(e) => e.preventDefault()}
      onClick={() => { lookupInDictionary(pick.text); document.getSelection()?.removeAllRanges(); setPick(null); }}>
      <BookA size={14} /> Consultar no dicionário
    </button>
  );
}
