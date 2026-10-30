import { useQueryClient } from '@tanstack/react-query';
import { BarChart3, BookOpenCheck, Brain, CheckCircle2, ChevronLeft, ChevronRight, Lightbulb, NotebookPen, RotateCcw, Scissors, Sparkles, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { answerFree, reviewDue, searchFree, type FreeFilters } from '../lib/practice.ts';
import {
  answerQuestion, explainQuestion, loadNote, mnemonicFor, nextQuestions, optionsOf, saveNote,
  type Explanation, type Mnemonic, type Question,
} from '../lib/questions.ts';
import { ArticleChips } from './ArticlePeek.tsx';
import { QuestionBody } from './QuestionBody.tsx';

// De onde vêm as questões: tarefa do cronograma, busca livre ou revisão do caderno de erros.
export type Source = { kind: 'task'; taskId: string } | { kind: 'free'; filters: FreeFilters } | { kind: 'review' };

const REASON: Record<string, string> = {
  'sem-materia': 'Esta tarefa não tem matéria para buscar questões.',
  'sem-assunto': 'Não encontramos no banco de questões assuntos que correspondam a esta sessão. Estude pela apostila e pela lei seca.',
  esgotado: 'Não há mais questões inéditas com esses filtros. Ótimo trabalho!',
  revisao: 'Nada para revisar hoje. As questões que você errar voltam aqui em 1, 7 e 30 dias.',
};

type Tab = 'explicacao' | 'mnemonico' | 'anotacoes';
interface QState {
  chosen: string | null; struck: string[];
  result: { correct: boolean; gabarito: string } | null;
  explanation: Explanation | null; mnemonic: Mnemonic | null | undefined; tab: Tab | null;
  shownAt: number; timeMs: number | null;
}
const blank = (): QState => ({ chosen: null, struck: [], result: null, explanation: null, mnemonic: undefined, tab: null, shownAt: Date.now(), timeMs: null });

// Resolução de questões: navegação livre, tachar, responder com botão, abas (explicação, mnemônico,
// anotações), tempo por questão e resumo da bateria.
export function QuestionsPanel({ source, goal = 0, answered = 0 }: { source: Source; goal?: number; answered?: number }) {
  const qc = useQueryClient();
  const taskId = source.kind === 'task' ? source.taskId : null;
  const [queue, setQueue] = useState<Question[]>([]);
  const [states, setStates] = useState<Record<string, QState>>({});
  const [idx, setIdx] = useState(0);
  const [assuntos, setAssuntos] = useState<string[]>([]);
  const [reason, setReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'' | 'answer' | 'explain' | 'mnemonic'>('');
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(false);
  const fetching = useRef(false);
  // A busca depende do conteúdo da origem, não da identidade do objeto (que muda a cada renderização).
  const srcKey = JSON.stringify(source), srcRef = useRef(source);
  srcRef.current = source;

  const load = useCallback(async (initial = false) => {
    const source = srcRef.current;
    if (fetching.current) return;
    fetching.current = true;
    if (initial) setLoading(true);
    try {
      const r = source.kind === 'task' ? await nextQuestions(source.taskId, 5)
        : source.kind === 'free' ? await searchFree(source.filters, 10)
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
  useEffect(() => { if (queue.length && idx >= queue.length - 2 && !reason) void load(); }, [idx, queue.length, reason, load]);

  const q = queue[idx];
  const st = (q && states[q.qid]) || blank();
  const patch = (p: Partial<QState>) => q && setStates((s) => ({ ...s, [q.qid]: { ...(s[q.qid] ?? blank()), ...p } }));
  const go = (i: number) => {
    if (i < 0 || i >= queue.length) return;
    const next = queue[i]!;
    setStates((s) => (s[next.qid] ? s : { ...s, [next.qid]: blank() })); // começa a contar o tempo ao abrir
    setIdx(i); setError(''); setSummary(false); window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  useEffect(() => { if (q && !states[q.qid]) setStates((s) => ({ ...s, [q.qid]: blank() })); }, [q, states]);

  const select = (letra: string) => { if (!st.result && !st.struck.includes(letra)) patch({ chosen: st.chosen === letra ? null : letra }); };
  const strike = (letra: string) => {
    if (st.result) return;
    patch({ struck: st.struck.includes(letra) ? st.struck.filter((l) => l !== letra) : [...st.struck, letra], chosen: st.chosen === letra ? null : st.chosen });
  };
  async function answer() {
    if (!q || !st.chosen || st.result) return;
    setBusy('answer');
    const timeMs = Date.now() - st.shownAt;
    try {
      const r = source.kind === 'task' ? await answerQuestion(source.taskId, q.qid, st.chosen, timeMs) : await answerFree(q.qid, st.chosen, source.kind, timeMs);
      patch({ result: r, tab: 'explicacao', timeMs });
      void qc.invalidateQueries({ queryKey: ['study'] });
      void qc.invalidateQueries({ queryKey: ['due-counts'] });
    } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  async function explain() {
    if (!q) return;
    setBusy('explain');
    try { patch({ explanation: (await explainQuestion(taskId, q.qid)).explanation }); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  async function mnemonic() {
    if (!q) return;
    setBusy('mnemonic');
    try { patch({ mnemonic: (await mnemonicFor(taskId, q.qid)).mnemonic }); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }

  // Atalhos: letras escolhem, Enter responde, setas navegam (fora de campos de texto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!q || summary || e.ctrlKey || e.metaKey || e.altKey || /^(TEXTAREA|INPUT|SELECT)$/.test((e.target as HTMLElement).tagName)) return;
      const opt = optionsOf(q).find((a) => a.letra.toLowerCase() === e.key.toLowerCase());
      if (opt) { e.preventDefault(); select(opt.letra); }
      else if (e.key === 'Enter') { e.preventDefault(); void answer(); }
      else if (e.key === 'ArrowRight') go(idx + 1);
      else if (e.key === 'ArrowLeft') go(idx - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (loading) return <div className="glass card" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="spinner" /> Buscando questões…</div>;
  if (!q) return <div className="glass card">{error ? <p className="error" style={{ margin: 0 }}>{error}</p> : <p style={{ margin: 0 }}>{REASON[reason ?? ''] ?? 'Nenhuma questão encontrada.'}</p>}</div>;

  const done = queue.filter((x) => states[x.qid]?.result);
  if (summary) return <BatchSummary queue={queue} states={states} onBack={() => setSummary(false)} />;
  const tab: Tab = st.tab ?? 'anotacoes';
  return (
    <div className="grid" style={{ gap: 14 }}>
      {goal > 0 && answered >= goal && <div className="glass card goal-done"><CheckCircle2 size={18} /> Meta de {goal} questões atingida! Você pode concluir a tarefa ou continuar treinando.</div>}

      <nav className="q-nav glass" aria-label="Navegação entre questões">
        <button className="icon-btn" onClick={() => go(idx - 1)} disabled={idx === 0} aria-label="Questão anterior"><ChevronLeft size={18} /></button>
        <div className="q-dots">
          {queue.map((x, i) => {
            const s = states[x.qid];
            return <button key={x.qid} className={'q-dot' + (i === idx ? ' on' : '') + (s?.result ? (s.result.correct ? ' right' : ' wrong') : s?.chosen ? ' picked' : '')}
              onClick={() => go(i)} aria-label={`Questão ${i + 1}${s?.result ? (s.result.correct ? ', certa' : ', errada') : ''}`}>{i + 1}</button>;
          })}
          {!reason && <span className="faint small">…</span>}
        </div>
        {!!done.length && <button className="btn ghost sm" onClick={() => setSummary(true)}><BarChart3 size={15} /> Resumo</button>}
        <button className="icon-btn" onClick={() => go(idx + 1)} disabled={idx >= queue.length - 1} aria-label="Próxima questão"><ChevronRight size={18} /></button>
      </nav>

      <article className="glass q-card">
        {source.kind === 'review' && <span className="badge orange" style={{ justifySelf: 'start' }}><RotateCcw size={12} /> Revisão do caderno de erros</span>}
        <QuestionBody q={q} number={idx + 1} chosen={st.chosen} struck={st.struck} gabarito={st.result?.gabarito ?? null} locked={!!st.result} onSelect={select} onStrike={strike} />

        {st.result ? (
          <div className={'q-result ' + (st.result.correct ? 'ok' : 'bad')}>
            {st.result.correct ? <><CheckCircle2 size={20} /> Você acertou!</> : <><XCircle size={20} /> Resposta certa: {st.result.gabarito}</>}
            {st.timeMs != null && <span className="faint small">{Math.round(st.timeMs / 1000)}s</span>}
            <div style={{ flex: 1 }} />
            {idx < queue.length - 1 ? <button className="btn sm" onClick={() => go(idx + 1)}>Próxima <ChevronRight size={15} /></button>
              : <button className="btn sm" onClick={() => setSummary(true)}><BarChart3 size={15} /> Ver resumo</button>}
          </div>
        ) : (
          <div className="q-actions">
            <button className="btn" disabled={!st.chosen || busy === 'answer'} onClick={answer}>{busy === 'answer' ? <><span className="spinner" /> Corrigindo…</> : 'Responder'}</button>
            <span className="faint small">Atalhos: letras para escolher · Enter responde · ← → navega · <Scissors size={11} /> tacha</span>
          </div>
        )}

        <div className="q-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'explicacao'} className={'tab' + (tab === 'explicacao' ? ' on' : '')} disabled={!st.result} title={st.result ? '' : 'Responda primeiro'} onClick={() => patch({ tab: 'explicacao' })}><Lightbulb size={15} /> Explicação</button>
          <button role="tab" aria-selected={tab === 'mnemonico'} className={'tab' + (tab === 'mnemonico' ? ' on' : '')} disabled={!st.result} title={st.result ? '' : 'Responda primeiro'} onClick={() => patch({ tab: 'mnemonico' })}><Brain size={15} /> Mnemônico</button>
          <button role="tab" aria-selected={tab === 'anotacoes'} className={'tab' + (tab === 'anotacoes' ? ' on' : '')} onClick={() => patch({ tab: 'anotacoes' })}><NotebookPen size={15} /> Anotações</button>
        </div>

        {tab === 'explicacao' && st.result && <ExplanationView ex={st.explanation} busy={busy === 'explain'} onExplain={explain} />}
        {tab === 'mnemonico' && st.result && <MnemonicView m={st.mnemonic} busy={busy === 'mnemonic'} onLoad={mnemonic} />}
        {tab === 'anotacoes' && <NoteBox qid={q.qid} />}
        {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      </article>
      <p className="faint small" style={{ margin: 0 }}>Questões do banco Quest API{assuntos.length ? ` · assuntos desta sessão: ${assuntos.slice(0, 3).join(', ')}` : ''}.</p>
    </div>
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

// Resumo da bateria: acertos, tempo médio e desempenho por assunto (o mais fraco primeiro).
function BatchSummary({ queue, states, onBack }: { queue: Question[]; states: Record<string, QState>; onBack: () => void }) {
  const done = queue.filter((x) => states[x.qid]?.result);
  const right = done.filter((x) => states[x.qid]!.result!.correct).length;
  const times = done.map((x) => states[x.qid]!.timeMs).filter((t): t is number => t != null);
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
        <div className="stat"><strong style={{ color: 'var(--cyan)' }}>{times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length / 1000) + 's' : '—'}</strong><span>por questão</span></div>
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
function NoteBox({ qid }: { qid: string }) {
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
    timer.current = setTimeout(() => { saveNote(qid, v).then(() => setStatus('salvo'), () => setStatus('erro')); }, 800);
  };
  return (
    <section className="q-note">
      <textarea className="textarea" value={text} disabled={status === 'carregando'} onChange={(e) => change(e.target.value)}
        placeholder="Seu resumo desta questão: o que ela cobra, onde errou, o artigo-chave…" maxLength={5000} />
      <span className="faint small">{status === 'salvando' ? 'Salvando…' : status === 'salvo' ? 'Salvo' : status === 'erro' ? 'Não foi possível salvar' : 'Só você vê suas anotações.'}</span>
    </section>
  );
}
