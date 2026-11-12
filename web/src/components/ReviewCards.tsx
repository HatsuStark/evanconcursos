import { useQueryClient } from '@tanstack/react-query';
import { ListChecks, RotateCcw, ScrollText } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { splitMarks } from '../../../shared/ai/marks.ts';
import { CLOZE_BLANK, asksRecall, buildReviewDeck, rememberAnswers, suggestVerdict, type CardAnswer, type ReviewCardType, type ReviewMemory, type ReviewSheet, type ReviewVerdict } from '../../../shared/domain/review-cards.ts';
import { loadReviewMemory, reviewSessionTracker, saveReviewMemory } from '../lib/reviewCards.ts';
import { answerTheoryReview, useTaskTheoryReview } from '../lib/theoryReviews.ts';
import { fmtDate } from './ui.tsx';

const TAGS: Record<ReviewCardType, [string, string]> = {
  recall: ['rc-recall', 'Tente lembrar'], cue: ['rc-cue', 'Gatilho de prova'], mnemo: ['rc-mnemo', 'Mnemônico'], cloze: ['rc-memo', 'Complete'], memo: ['rc-memo', 'Para memorizar'], trap: ['rc-trap', 'Pegadinha'],
};
const VERDICTS: { v: ReviewVerdict; label: string }[] = [{ v: 'lembrei', label: 'Lembrei bem' }, { v: 'parcial', label: 'Lembrei em parte' }, { v: 'esqueci', label: 'Esqueci' }];

const Marked = ({ text }: { text: string }) => <>{splitMarks(text).map((p, i) => (p.bold ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>))}</>;
// Frase com lacuna: o espaço em branco aparece como um traço destacado.
const Blanked = ({ text }: { text: string }) => <>{text.split(CLOZE_BLANK).map((t, i) => <span key={i}>{i > 0 && <span className="rc-blank" aria-label="lacuna" />}{t}</span>)}</>;

// Revisão curta em cartões: um por vez, com a resposta escondida nos de recordação. No fim, placar e o resultado da
// revisão de teoria já sugerido.
export function ReviewCards({ taskId, title, sheet, onShowSheet, onGoQuestions }: {
  taskId: string; title: string; sheet: ReviewSheet; onShowSheet: () => void; onGoQuestions?: () => void;
}) {
  const qc = useQueryClient();
  const due = useTaskTheoryReview(taskId);
  // Memória do banco (o que já sabe, o que não lembrou, o que já leu). O baralho é montado ao carregar e ao recomeçar;
  // gravar a memória no fim não troca os cartões na tela.
  const memory = useRef<ReviewMemory | null>(null);
  const [seed, setSeed] = useState(0);
  useEffect(() => {
    let off = false;
    memory.current = null; setSeed(0);
    void loadReviewMemory(taskId).then((m) => { if (!off) { memory.current = m; setSeed((x) => x + 1); } });
    return () => { off = true; };
  }, [taskId]);
  const deck = useMemo(() => (seed && memory.current ? buildReviewDeck(sheet, memory.current) : null), [sheet, seed]);
  const track = useRef(reviewSessionTracker(taskId));
  const [idx, setIdx] = useState(0);
  const [shown, setShown] = useState(false);
  const [answers, setAnswers] = useState<Record<string, CardAnswer>>({});
  const [verdict, setVerdict] = useState<ReviewVerdict | null>(null);
  const [saved, setSaved] = useState<{ next: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const started = useRef(Date.now());

  const cards = deck?.cards ?? [], done = idx >= cards.length, c = cards[idx];
  const asks = cards.filter((x) => asksRecall(x.type));
  const right = asks.filter((x) => answers[x.id] === 'know').length;
  const suggested = suggestVerdict(right, asks.length);

  function answer(a: CardAnswer) {
    if (!c) return;
    const next = { ...answers, [c.id]: a };
    setAnswers(next); setShown(false); setIdx(idx + 1);
    const finished = idx + 1 >= cards.length, vals = asks.map((x) => next[x.id]);
    track.current({
      cards: cards.length, recallCards: asks.length, answered: Object.keys(next).length, remembered: vals.filter((v) => v === 'know').length,
      missed: vals.filter((v) => v === 'again').length, durationS: (Date.now() - started.current) / 1000, completed: finished,
    });
    if (finished && memory.current) {
      memory.current = rememberAnswers(memory.current, next, deck!.restarted);
      void saveReviewMemory(taskId, memory.current).catch(() => {});
    }
  }
  function back() {
    if (idx === 0) return;
    const prev = cards[idx - 1]!, next = { ...answers }; delete next[prev.id];
    setAnswers(next); setShown(false); setIdx(idx - 1);
  }
  function restart() {
    setSeed((x) => x + 1); track.current = reviewSessionTracker(taskId); setIdx(0); setShown(false); setAnswers({}); setVerdict(null); setSaved(null); setError(''); started.current = Date.now();
  }
  async function register() {
    if (!due.data) return;
    setBusy(true); setError('');
    try {
      setSaved({ next: await answerTheoryReview(due.data.id, verdict ?? suggested) });
      await qc.invalidateQueries({ queryKey: ['theory-reviews'] });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  // Teclado: espaço revela ou passa; → já sei / próximo; ← não lembrei (com a resposta aberta) ou volta.
  const keyRef = useRef<(k: string) => boolean>(() => false);
  keyRef.current = (k) => {
    if (!c) return false;
    const ask = asksRecall(c.type);
    if (k === ' ' || k === 'Enter') { if (ask && !shown) setShown(true); else if (!ask) answer('read'); else return false; return true; }
    if (k === 'ArrowRight') { if (ask && shown) answer('know'); else if (!ask) answer('read'); else setShown(true); return true; }
    if (k === 'ArrowLeft') { if (ask && shown) answer('again'); else back(); return true; }
    return false;
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.altKey || e.ctrlKey || e.metaKey || t.closest('input, textarea, select, [contenteditable="true"], .dict')) return;
      if (t.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
      if (keyRef.current(e.key)) e.preventDefault();
    };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, []);
  // Deslizar no celular: direita = já sei / próximo, esquerda = não lembrei / volta.
  const x0 = useRef<number | null>(null);
  const swipe = {
    onPointerDown: (e: React.PointerEvent) => { if (e.pointerType !== 'mouse') x0.current = e.clientX; },
    onPointerUp: (e: React.PointerEvent) => {
      if (x0.current == null) return;
      const dx = e.clientX - x0.current; x0.current = null;
      if (Math.abs(dx) >= 60) keyRef.current(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
    },
  };

  if (!deck) return <div className="glass card" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="spinner" /> Preparando os cartões…</div>;
  if (!cards.length) return null;
  const minutes = Math.max(1, Math.round((Date.now() - started.current) / 60000));
  const estimate = Math.max(1, Math.round(cards.length * 12 / 60));

  return (
    <div className="glass rc">
      <div className="rc-top">
        <div className="rc-row">
          <strong>{title}</strong>
          <button className="link-btn rc-sheet" onClick={onShowSheet}><ScrollText size={14} /> Ver folha completa</button>
        </div>
        <div className="rc-prog" aria-hidden="true">
          {cards.map((x, i) => <i key={x.id} className={answers[x.id] === 'again' ? 'miss' : answers[x.id] ? 'done' : i === idx ? 'cur' : ''} />)}
        </div>
        <div className="rc-row muted small">{done ? 'Concluída' : `${idx + 1} de ${cards.length} · ~${estimate} min`}{deck.restarted && !done && ' · você já sabia tudo; revisão completa de novo'}</div>
      </div>

      {!done && c && (
        <div className="rc-stage" {...swipe}>
          <div key={c.id} className="rc-card" aria-live="polite">
            <span className={'rc-tag ' + TAGS[c.type][0]}>{TAGS[c.type][1]}</span>
            {c.type === 'mnemo' ? <>
              <p className="rc-big"><Marked text={c.front || 'O que esta sigla resume?'} /></p>
              <div className="rc-mn">{c.mnemonic}</div>
            </> : c.type === 'cloze' ? <p className="rc-big"><Blanked text={c.front} /></p>
              : asksRecall(c.type) ? <p className="rc-big"><Marked text={c.front} /></p>
              : <p className={c.type === 'trap' ? 'rc-trap-text' : 'rc-memo-text'}><Marked text={c.front} /></p>}
            {asksRecall(c.type) && (shown
              ? <div className="rc-answer"><Marked text={c.back ?? ''} /></div>
              : <button className="rc-reveal" onClick={() => setShown(true)}>{c.type === 'mnemo' ? 'Tente decifrar cada letra.' : c.type === 'cloze' ? 'Complete de cabeça.' : 'Responda de cabeça.'} Toque para ver.</button>)}
          </div>
          {asksRecall(c.type) && !shown ? <div className="rc-hint">Espaço ou toque para revelar{idx > 0 ? ' · ← volta' : ''}</div>
            : asksRecall(c.type) ? <>
              <div className="rc-actions"><button className="btn rc-again" onClick={() => answer('again')}>Não lembrei</button><button className="btn rc-know" onClick={() => answer('know')}>Já sei</button></div>
              <div className="rc-hint">← não lembrei · → já sei</div>
            </> : <>
              <div className="rc-actions one"><button className="btn" onClick={() => answer('read')}>Próximo</button></div>
              <div className="rc-hint">→ próximo{idx > 0 ? ' · ← volta' : ''}</div>
            </>}
        </div>
      )}

      {done && (
        <div className="rc-stage">
          <div className="rc-card rc-end">
            <span className="rc-tag rc-cue">Revisão concluída</span>
            {asks.length ? <><div className="rc-score">{right}/{asks.length}</div><p className="muted">lembrados de cabeça · {minutes} min</p></> : <p className="muted">Leitura concluída · {minutes} min</p>}
            {asks.some((x) => answers[x.id] === 'again') && <>
              <p className="small muted" style={{ margin: 0 }}>Vão aparecer primeiro na próxima vez:</p>
              <ul className="rc-miss">{asks.filter((x) => answers[x.id] === 'again').map((x) => <li key={x.id}><Marked text={x.type === 'mnemo' ? `${x.mnemonic}: ${x.back ?? ''}` : x.back ?? ''} /></li>)}</ul>
            </>}
            {due.data && !saved && (
              <div className="rc-verdict">
                <span className="small">Como foi esta revisão ({due.data.stage} de 3)?</span>
                <div className="segmented">{VERDICTS.map((x) => <button key={x.v} className={(verdict ?? suggested) === x.v ? 'on' : ''} onClick={() => setVerdict(x.v)}>{x.label}</button>)}</div>
                <button className="btn sm" disabled={busy} onClick={register}>{busy ? <><span className="spinner" /> Registrando…</> : 'Registrar revisão'}</button>
                {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
              </div>
            )}
            {saved && <p className="rc-saved"><RotateCcw size={15} /> {saved.next ? `Revisão registrada. Este tema volta em ${fmtDate(saved.next)}.` : 'Revisões deste tema concluídas.'}</p>}
            <div className="rc-links">
              {onGoQuestions && <button className="btn" onClick={onGoQuestions}><ListChecks size={16} /> Fazer questões do tema</button>}
              <button className="link-btn" onClick={restart}>Revisar de novo</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
