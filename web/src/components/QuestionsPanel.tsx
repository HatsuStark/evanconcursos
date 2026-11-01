import { useQueryClient } from '@tanstack/react-query';
import { BarChart3, BookOpenCheck, Brain, CheckCircle2, ChevronLeft, ChevronRight, Lightbulb, MessageCircle, NotebookPen, RotateCcw, Scissors, Sparkles, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { reviewDue, searchFree, type FreeFilters } from '../lib/practice.ts';
import {
  answerQuestion, explainQuestion, loadNote, mnemonicFor, nextQuestions, optionsOf, saveNote,
  type Explanation, type Mnemonic, type Question,
} from '../lib/questions.ts';
import { mayHaveMnemonic } from '../../../shared/qbank/mnemonic.ts';
import { ArticleChips } from './ArticlePeek.tsx';
import { CommentsPanel } from './CommentsPanel.tsx';
import { ErrorReasonPicker } from './ErrorReason.tsx';
import { QuestionBody } from './QuestionBody.tsx';

// De onde vêm as questões: tarefa do cronograma, busca livre ou revisão do caderno de erros.
export type Source = { kind: 'task'; taskId: string; planId: string } | { kind: 'free'; filters: FreeFilters } | { kind: 'review' };

const REASON: Record<string, string> = {
  'sem-materia': 'Esta tarefa não tem matéria para buscar questões.',
  'sem-assunto': 'Não encontramos no banco de questões assuntos que correspondam a esta sessão. Estude pela apostila e pela lei seca.',
  esgotado: 'Não há mais questões inéditas com esses filtros. Ótimo trabalho!',
  revisao: 'Nada para revisar hoje. As questões que você errar voltam aqui em 1, 7 e 30 dias.',
};

type Tab = 'explicacao' | 'mnemonico' | 'anotacoes' | 'comentarios';
interface QState {
  chosen: string | null; struck: string[];
  result: { correct: boolean; gabarito: string } | null;
  explanation: Explanation | null; mnemonic: Mnemonic | null | undefined; tab: Tab | null;
}
const blank = (): QState => ({ chosen: null, struck: [], result: null, explanation: null, mnemonic: undefined, tab: null });

const PAGE_SIZES = [1, 5, 10];
const PAGE_KEY = 'questions-per-page';
const storedPageSize = () => { try { const n = Number(localStorage.getItem(PAGE_KEY)); return PAGE_SIZES.includes(n) ? n : 1; } catch { return 1; } };

// Resolução de questões: navegação livre, tachar, responder com botão, abas (explicação, mnemônico,
// anotações) e resumo da bateria. Com `paged`, o estudante escolhe quantas ver por página. Tempo só existe no simulado.
export function QuestionsPanel({ source, goal = 0, answered = 0, paged = false }: { source: Source; goal?: number; answered?: number; paged?: boolean }) {
  const taskId = source.kind === 'task' ? source.taskId : null;
  const [queue, setQueue] = useState<Question[]>([]);
  const [states, setStates] = useState<Record<string, QState>>({});
  const [idx, setIdx] = useState(0); // primeira questão da página
  const [pageSize, setPageSize] = useState(() => (paged ? storedPageSize() : 1));
  const [assuntos, setAssuntos] = useState<string[]>([]);
  const [reason, setReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(false);
  const fetching = useRef(false);
  const sizeRef = useRef(pageSize);
  sizeRef.current = pageSize;
  // A busca depende do conteúdo da origem, não da identidade do objeto (que muda a cada renderização).
  const srcKey = JSON.stringify(source), srcRef = useRef(source);
  srcRef.current = source;

  const load = useCallback(async (initial = false) => {
    const source = srcRef.current;
    if (fetching.current) return;
    fetching.current = true;
    if (initial) setLoading(true);
    try {
      // Cada questão nova custa créditos: a busca livre traz só o que a página vai mostrar.
      const r = source.kind === 'task' ? await nextQuestions(source.taskId, 5)
        : source.kind === 'free' ? await searchFree(source.filters, Math.max(sizeRef.current, 5))
        : { ...(await reviewDue(20)), reason: 'revisao' as string | null };
      setQueue((q) => [...q, ...r.questions.filter((n) => !q.some((o) => o.qid === n.qid))]);
      const filter = (r as { filter?: { assuntos: string[] } }).filter;
      if (filter) setAssuntos(filter.assuntos);
      // Revisão vem num lote só; nas demais, lista vazia significa fim.
      if (!r.questions.length || source.kind === 'review') setReason(r.reason ?? 'esgotado');
      setError('');
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); fetching.current = false; }
  }, [srcKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(true); }, [load]);
  // Com uma por página, deixa folga para a próxima abrir na hora; com mais, só carrega ao faltar questão na página.
  useEffect(() => { if (queue.length && queue.length < idx + pageSize + (pageSize === 1 ? 2 : 0) && !reason) void load(); }, [idx, pageSize, queue.length, reason, load]);

  // Avançar além do que já veio dispara a busca acima: a próxima página só gasta créditos se for aberta. Se não vier nada, volta.
  useEffect(() => { if (reason && queue.length && idx >= queue.length) setIdx(Math.floor((queue.length - 1) / pageSize) * pageSize); }, [reason, idx, queue.length, pageSize]);

  const go = (i: number) => {
    if (i < 0 || (i >= queue.length && (reason || i > idx + pageSize))) return;
    setIdx(Math.floor(i / pageSize) * pageSize); setError(''); setSummary(false); window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  function changeSize(n: number) {
    setPageSize(n);
    setIdx(Math.floor(idx / n) * n); // a questão atual continua na tela
    try { localStorage.setItem(PAGE_KEY, String(n)); } catch { /* sem armazenamento */ }
  }

  if (loading) return <div className="glass card" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="spinner" /> Buscando questões…</div>;
  if (!queue[idx] && queue.length && !reason && !error) return <div className="glass card" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="spinner" /> Buscando questões…</div>;
  if (!queue[idx]) return <div className="glass card">{error ? <p className="error" style={{ margin: 0 }}>{error}</p> : <p style={{ margin: 0 }}>{source.kind === 'free' ? 'Nenhuma questão inédita com esses filtros. Tente outra matéria ou tire algum filtro.' : REASON[reason ?? ''] ?? 'Nenhuma questão encontrada.'}</p>}</div>;

  const done = queue.filter((x) => states[x.qid]?.result);
  if (summary) return <BatchSummary queue={queue} states={states} onBack={() => setSummary(false)} />;
  const visible = queue.slice(idx, idx + pageSize), hasNext = idx + pageSize < queue.length || !reason;
  const unit = pageSize === 1 ? 'Questão' : 'Página';
  const pages = Array.from({ length: Math.ceil(queue.length / pageSize) }, (_, p) => queue.slice(p * pageSize, (p + 1) * pageSize));
  return (
    <div className="grid" style={{ gap: 14, gridTemplateColumns: 'minmax(0, 1fr)' }}>
      {goal > 0 && answered >= goal && <div className="glass card goal-done"><CheckCircle2 size={18} /> Meta de {goal} questões atingida! Você pode concluir a tarefa ou continuar treinando.</div>}

      {paged && (
        <div className="q-page-size">
          <span className="muted small" id="q-page-size-label">Questões por página</span>
          <div className="segmented" role="group" aria-labelledby="q-page-size-label">
            {PAGE_SIZES.map((n) => <button key={n} className={pageSize === n ? 'on' : ''} aria-pressed={pageSize === n} onClick={() => changeSize(n)}>{n}</button>)}
          </div>
        </div>
      )}

      <nav className="q-nav glass" aria-label={pageSize === 1 ? 'Navegação entre questões' : 'Navegação entre páginas'}>
        <button className="icon-btn" onClick={() => go(idx - pageSize)} disabled={idx === 0} aria-label={`${unit} anterior`}><ChevronLeft size={18} /></button>
        <div className="q-dots">
          {pageSize === 1 ? queue.map((x, i) => {
            const s = states[x.qid];
            return <button key={x.qid} className={'q-dot' + (i === idx ? ' on' : '') + (s?.result ? (s.result.correct ? ' right' : ' wrong') : s?.chosen ? ' picked' : '')}
              onClick={() => go(i)} aria-label={`Questão ${i + 1}${s?.result ? (s.result.correct ? ', certa' : ', errada') : ''}`}>{i + 1}</button>;
          }) : pages.map((items, p) => {
            // Uma página pode misturar acertos e erros: a cor diz só até onde foi respondida.
            const n = items.filter((x) => states[x.qid]?.result).length;
            return <button key={p} className={'q-dot' + (p * pageSize === idx ? ' on' : '') + (n === items.length ? ' done' : n || items.some((x) => states[x.qid]?.chosen) ? ' picked' : '')}
              onClick={() => go(p * pageSize)} aria-label={`Página ${p + 1}, ${n} de ${items.length} respondidas`}>{p + 1}</button>;
          })}
          {!reason && <span className="faint small">…</span>}
        </div>
        {!!done.length && <button className="btn ghost sm" onClick={() => setSummary(true)}><BarChart3 size={15} /> Resumo</button>}
        <button className="icon-btn" onClick={() => go(idx + pageSize)} disabled={!hasNext} aria-label={`Próxima ${unit.toLowerCase()}`}><ChevronRight size={18} /></button>
      </nav>

      {visible.map((q, i) => (
        <QuestionCard key={q.qid} q={q} number={idx + i + 1} st={states[q.qid] ?? blank()} source={source} single={pageSize === 1} isLast={!hasNext}
          onPatch={(p) => setStates((s) => ({ ...s, [q.qid]: { ...(s[q.qid] ?? blank()), ...p } }))}
          onPrev={() => go(idx - 1)} onNext={() => go(idx + 1)} onSummary={() => setSummary(true)} />
      ))}

      {pageSize > 1 && (
        <div className="q-page-nav">
          <button className="btn ghost sm" disabled={idx === 0} onClick={() => go(idx - pageSize)}><ChevronLeft size={15} /> Página anterior</button>
          {hasNext ? <button className="btn sm" onClick={() => go(idx + pageSize)}>Próxima página <ChevronRight size={15} /></button>
            : !!done.length && <button className="btn sm" onClick={() => setSummary(true)}><BarChart3 size={15} /> Ver resumo</button>}
        </div>
      )}
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      <p className="faint small" style={{ margin: 0 }}>Questões do banco Quest API{assuntos.length ? ` · assuntos desta sessão: ${assuntos.slice(0, 3).join(', ')}` : ''}.</p>
    </div>
  );
}

// Uma questão: alternativas, resposta, explicação, mnemônico, anotações e comentários. Os atalhos de teclado só valem
// com uma questão na tela, porque com várias não dá para saber a qual delas a tecla se refere.
function QuestionCard({ q, number, st, source, single, isLast, onPatch, onPrev, onNext, onSummary }: {
  q: Question; number: number; st: QState; source: Source; single: boolean; isLast: boolean;
  onPatch: (p: Partial<QState>) => void; onPrev: () => void; onNext: () => void; onSummary: () => void;
}) {
  const qc = useQueryClient();
  const taskId = source.kind === 'task' ? source.taskId : null;
  const [busy, setBusy] = useState<'' | 'answer' | 'explain' | 'mnemonic'>('');
  const [error, setError] = useState('');
  const patch = onPatch;

  const select = (letra: string) => { if (!st.result && !st.struck.includes(letra)) patch({ chosen: st.chosen === letra ? null : letra }); };
  const strike = (letra: string) => {
    if (st.result) return;
    patch({ struck: st.struck.includes(letra) ? st.struck.filter((l) => l !== letra) : [...st.struck, letra], chosen: st.chosen === letra ? null : st.chosen });
  };
  async function answer() {
    if (!st.chosen || st.result) return;
    setBusy('answer'); setError('');
    try {
      const r = await answerQuestion(taskId, q.qid, st.chosen, source.kind === 'task' ? 'plan' : source.kind);
      patch({ result: r, tab: 'explicacao' });
      void qc.invalidateQueries({ queryKey: ['study'] });
      void qc.invalidateQueries({ queryKey: ['due-counts'] });
    } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  async function explain() {
    setBusy('explain'); setError('');
    try { patch({ explanation: (await explainQuestion(taskId, q.qid)).explanation }); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  async function mnemonic() {
    setBusy('mnemonic'); setError('');
    try { patch({ mnemonic: (await mnemonicFor(taskId, q.qid)).mnemonic }); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }

  // Atalhos: letras escolhem, Enter responde, setas navegam (fora de campos de texto).
  useEffect(() => {
    if (!single) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || /^(TEXTAREA|INPUT|SELECT)$/.test((e.target as HTMLElement).tagName)) return;
      const opt = optionsOf(q).find((a) => a.letra.toLowerCase() === e.key.toLowerCase());
      if (opt) { e.preventDefault(); select(opt.letra); }
      else if (e.key === 'Enter') { e.preventDefault(); void answer(); }
      else if (e.key === 'ArrowRight') onNext();
      else if (e.key === 'ArrowLeft') onPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Aba Mnemônico só quando faz sentido: já existe, ou a questão tem cara de conteúdo memorizável (regra
  // gratuita). Se a IA avaliar que não cabe, some (e fica descartada para todos).
  const showMnemo = st.mnemonic !== null && mayHaveMnemonic(q);
  const tab: Tab = st.tab === 'mnemonico' && !showMnemo ? 'explicacao' : st.tab ?? 'anotacoes';
  return (
      <article className="glass q-card">
        {source.kind === 'review' && <span className="badge orange" style={{ justifySelf: 'start' }}><RotateCcw size={12} /> Revisão do caderno de erros</span>}
        <QuestionBody q={q} number={number} chosen={st.chosen} struck={st.struck} gabarito={st.result?.gabarito ?? null} locked={!!st.result} onSelect={select} onStrike={strike} />

        {st.result ? (
          <div className={'q-result ' + (st.result.correct ? 'ok' : 'bad')}>
            {st.result.correct ? <><CheckCircle2 size={20} /> Você acertou!</> : <><XCircle size={20} /> Resposta certa: {st.result.gabarito}</>}
            <div style={{ flex: 1 }} />
            {single && (!isLast ? <button className="btn sm" onClick={onNext}>Próxima <ChevronRight size={15} /></button>
              : <button className="btn sm" onClick={onSummary}><BarChart3 size={15} /> Ver resumo</button>)}
          </div>
        ) : (
          <div className="q-actions">
            <button className="btn" disabled={!st.chosen || busy === 'answer'} onClick={answer}>{busy === 'answer' ? <><span className="spinner" /> Corrigindo…</> : 'Responder'}</button>
            {single && <span className="faint small">Atalhos: letras para escolher · Enter responde · ← → navega · <Scissors size={11} /> tacha</span>}
          </div>
        )}

        {st.result && !st.result.correct && <ErrorReasonPicker qid={q.qid} />}

        <div className="q-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'explicacao'} className={'tab' + (tab === 'explicacao' ? ' on' : '')} disabled={!st.result} title={st.result ? '' : 'Responda primeiro'} onClick={() => patch({ tab: 'explicacao' })}><Lightbulb size={15} /> Explicação</button>
          {showMnemo && <button role="tab" aria-selected={tab === 'mnemonico'} className={'tab' + (tab === 'mnemonico' ? ' on' : '')} disabled={!st.result} title={st.result ? '' : 'Responda primeiro'} onClick={() => patch({ tab: 'mnemonico' })}><Brain size={15} /> Mnemônico</button>}
          <button role="tab" aria-selected={tab === 'anotacoes'} className={'tab' + (tab === 'anotacoes' ? ' on' : '')} onClick={() => patch({ tab: 'anotacoes' })}><NotebookPen size={15} /> Anotações</button>
          <button role="tab" aria-selected={tab === 'comentarios'} className={'tab' + (tab === 'comentarios' ? ' on' : '')} disabled={!st.result} title={st.result ? '' : 'Responda primeiro'} onClick={() => patch({ tab: 'comentarios' })}><MessageCircle size={15} /> Comentários</button>
        </div>

        {tab === 'explicacao' && st.result && <ExplanationView ex={st.explanation} busy={busy === 'explain'} onExplain={explain} />}
        {tab === 'mnemonico' && st.result && showMnemo && <MnemonicView m={st.mnemonic} busy={busy === 'mnemonic'} onLoad={mnemonic} />}
        {st.mnemonic === null && tab === 'explicacao' && <p className="faint small" style={{ margin: 0 }}>Esta questão não pede memorização; o mnemônico foi dispensado.</p>}
        {tab === 'anotacoes' && <NoteBox qid={q.qid} planId={source.kind === 'task' ? source.planId : undefined} />}
        {tab === 'comentarios' && st.result && <CommentsPanel qid={q.qid} />}
        {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      </article>
  );
}

export function ExplanationView({ ex, busy, onExplain }: { ex: Explanation | null; busy: boolean; onExplain: () => void }) {
  if (!ex) return <button className="btn ghost sm" style={{ justifySelf: 'start' }} disabled={busy} onClick={onExplain}>{busy ? <><span className="spinner" /> Explicando…</> : <><Sparkles size={15} /> Explicar com IA</>}</button>;
  return (
    <section className="q-explain">
      <p><Lightbulb size={16} style={{ verticalAlign: -3, color: 'var(--orange)' }} /> {ex.resumo}</p>
      <ul>{ex.alternativas.map((a) => <li key={a.letra}><b>{a.letra})</b> {a.comentario}</li>)}</ul>
      {ex.dica && <p className="muted"><b>Atenção:</b> {ex.dica}</p>}
      {!!ex.artigos.length && <ArticleChips refs={ex.artigos} />}
      <p className="faint small"><BookOpenCheck size={13} style={{ verticalAlign: -2 }} /> {ex.artigos.length ? 'Toque no artigo para ler o texto oficial.' : 'Explicação sem citação de artigos (nenhum trecho de lei correspondente).'} Gerada por IA a partir do gabarito oficial; confira.</p>
    </section>
  );
}

export function MnemonicView({ m, busy, onLoad }: { m: Mnemonic | null | undefined; busy: boolean; onLoad: () => void }) {
  if (m === undefined) return <button className="btn ghost sm" style={{ justifySelf: 'start' }} disabled={busy} onClick={onLoad}>{busy ? <><span className="spinner" /> Pensando…</> : <><Brain size={15} /> Ver mnemônico</>}</button>;
  if (m === null) return <p className="muted" style={{ margin: 0 }}>Esta questão não pede memorização (é de interpretação, raciocínio ou um detalhe isolado): um mnemônico seria forçado.</p>;
  return (
    <section className="q-mnemonic">
      <span className="faint small">{m.concept}</span>
      <strong className="q-mnemonic-word">{m.mnemonic}</strong>
      {!!m.items.length && <ul>{m.items.map((it, i) => <li key={i}><b>{it.chave}</b> {it.significado}</li>)}</ul>}
      {m.explanation && <p className="muted" style={{ margin: 0 }}>{m.explanation}</p>}
      <span className="faint small">Mnemônico gerado por IA, compartilhado entre questões do mesmo conceito e salvo nos seus flashcards; confira com a lei.</span>
    </section>
  );
}

// Resumo da bateria: acertos e desempenho por assunto (o mais fraco primeiro).
function BatchSummary({ queue, states, onBack }: { queue: Question[]; states: Record<string, QState>; onBack: () => void }) {
  const done = queue.filter((x) => states[x.qid]?.result);
  const right = done.filter((x) => states[x.qid]!.result!.correct).length;
  const by = new Map<string, { t: number; c: number }>();
  for (const x of done) { const e = by.get(x.assunto || 'Sem assunto') ?? { t: 0, c: 0 }; e.t++; if (states[x.qid]!.result!.correct) e.c++; by.set(x.assunto || 'Sem assunto', e); }
  const rows = [...by].sort((a, b) => a[1].c / a[1].t - b[1].c / b[1].t);
  const pct = done.length ? Math.round((right / done.length) * 100) : 0;
  return (
    <div className="glass card summary">
      <h2 style={{ margin: 0 }}>Resumo da bateria</h2>
      <div className="stats">
        <div className="stat"><strong style={{ color: 'var(--violet)' }}>{done.length}</strong><span>respondidas</span></div>
        <div className="stat"><strong style={{ color: pct >= 75 ? 'var(--lime)' : 'var(--orange)' }}>{pct}%</strong><span>de acerto</span></div>
        <div className="stat"><strong style={{ color: 'var(--cyan)' }}>{by.size}</strong><span>assuntos</span></div>
      </div>
      <table className="sum-table"><thead><tr><th>Assunto</th><th>Acertos</th><th /></tr></thead><tbody>
        {rows.map(([a, e]) => <tr key={a}><td>{a}</td><td>{e.c}/{e.t}</td><td style={{ width: '40%' }}><div className="bar"><span style={{ width: `${(e.c / e.t) * 100}%`, background: e.c / e.t >= 0.75 ? 'var(--lime)' : 'var(--orange)' }} /></div></td></tr>)}
      </tbody></table>
      {rows[0] && rows[0][1].c / rows[0][1].t < 0.75 && <p className="muted" style={{ margin: 0 }}>Ponto a reforçar: <b>{rows[0][0]}</b>. As questões erradas já estão no seu caderno de erros e voltam amanhã.</p>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn" onClick={onBack}>Continuar resolvendo</button>
        <Link className="btn ghost" to="/questoes?aba=revisar">Caderno de erros</Link>
      </div>
    </div>
  );
}

// Anotação pessoal da questão (resumos), salva sozinha enquanto digita.
function NoteBox({ qid, planId }: { qid: string; planId?: string }) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'' | 'carregando' | 'salvando' | 'salvo' | 'erro'>('carregando');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let alive = true;
    setStatus('carregando');
    loadNote(qid).then((n) => { if (alive) { setText(n); setStatus(''); } }, () => alive && setStatus('erro'));
    return () => { alive = false; };
  }, [qid]);
  const change = (v: string) => {
    setText(v); setStatus('salvando');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { saveNote(qid, v, planId).then(() => setStatus('salvo'), () => setStatus('erro')); }, 800);
  };
  return (
    <section className="q-note">
      <textarea className="textarea" value={text} disabled={status === 'carregando'} onChange={(e) => change(e.target.value)}
        placeholder="Seu resumo desta questão: o que ela cobra, onde errou, o artigo-chave…" maxLength={5000} />
      <span className="faint small">{status === 'salvando' ? 'Salvando…' : status === 'salvo' ? 'Salvo' : status === 'erro' ? 'Não foi possível salvar' : 'Só você vê suas anotações.'}</span>
    </section>
  );
}
