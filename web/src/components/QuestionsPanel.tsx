import { useQueryClient } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import { BookOpenCheck, Brain, CheckCircle2, ChevronLeft, ChevronRight, Lightbulb, NotebookPen, Scissors, Sparkles, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  answerQuestion, explainQuestion, loadNote, mnemonicFor, nextQuestions, optionsOf, sameAnswer, saveNote,
  type Explanation, type Mnemonic, type NextResult, type Question,
} from '../lib/questions.ts';

// HTML das questões vem de fora: sempre limpo antes de exibir (sem scripts, eventos ou iframes).
const safe = (html: string) => ({ __html: DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'iframe', 'form', 'input'] }) });

const REASON: Record<string, string> = {
  'sem-materia': 'Esta tarefa não tem matéria para buscar questões.',
  'sem-assunto': 'Não encontramos no banco de questões assuntos que correspondam a esta sessão. Estude pela lei seca e pela apostila.',
  esgotado: 'Você já respondeu todas as questões disponíveis para esta sessão. Ótimo trabalho!',
};

type Tab = 'explicacao' | 'mnemonico' | 'anotacoes';
interface QState {
  chosen: string | null;
  struck: string[];                                   // alternativas tachadas (eliminadas pelo estudante)
  result: { correct: boolean; gabarito: string } | null;
  explanation: Explanation | null;
  mnemonic: Mnemonic | null | undefined;              // undefined = ainda não pedido; null = não cabe mnemônico
  tab: Tab | null;
}
const blank = (): QState => ({ chosen: null, struck: [], result: null, explanation: null, mnemonic: undefined, tab: null });

// Resolução de questões no app: navegação livre (avançar/voltar sem responder), tachar alternativas,
// responder com botão, e abas de explicação, mnemônico e anotações.
export function QuestionsPanel({ taskId, goal, answered }: { taskId: string; goal: number; answered: number }) {
  const qc = useQueryClient();
  const [queue, setQueue] = useState<Question[]>([]);
  const [states, setStates] = useState<Record<string, QState>>({});
  const [idx, setIdx] = useState(0);
  const [info, setInfo] = useState<NextResult['filter'] | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'' | 'answer' | 'explain' | 'mnemonic'>('');
  const [error, setError] = useState('');
  const fetching = useRef(false);

  const load = useCallback(async (initial = false) => {
    if (fetching.current) return;
    fetching.current = true;
    if (initial) setLoading(true);
    try {
      const r = await nextQuestions(taskId, 5);
      setQueue((q) => [...q, ...r.questions.filter((n) => !q.some((o) => o.qid === n.qid))]);
      if (r.filter) setInfo(r.filter);
      if (!r.questions.length) setReason(r.reason);
      setError('');
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); fetching.current = false; }
  }, [taskId]);
  useEffect(() => { void load(true); }, [load]);
  // Busca o próximo lote antes de acabar a fila.
  useEffect(() => { if (queue.length && idx >= queue.length - 2 && !reason) void load(); }, [idx, queue.length, reason, load]);

  const q = queue[idx];
  const st = (q && states[q.qid]) || blank();
  const patch = (p: Partial<QState>) => q && setStates((s) => ({ ...s, [q.qid]: { ...(s[q.qid] ?? blank()), ...p } }));
  const go = (i: number) => { if (i >= 0 && i < queue.length) { setIdx(i); setError(''); window.scrollTo({ top: 0, behavior: 'smooth' }); } };

  const select = (letra: string) => { if (!st.result && !st.struck.includes(letra)) patch({ chosen: st.chosen === letra ? null : letra }); };
  const strike = (letra: string) => {
    if (st.result) return;
    const struck = st.struck.includes(letra) ? st.struck.filter((l) => l !== letra) : [...st.struck, letra];
    patch({ struck, chosen: st.chosen === letra ? null : st.chosen });
  };
  async function answer() {
    if (!q || !st.chosen || st.result) return;
    setBusy('answer');
    try {
      const r = await answerQuestion(taskId, q.qid, st.chosen);
      patch({ result: r, tab: 'explicacao' });
      void qc.invalidateQueries({ queryKey: ['study'] });
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
      if (!q || e.ctrlKey || e.metaKey || e.altKey || /^(TEXTAREA|INPUT|SELECT)$/.test((e.target as HTMLElement).tagName)) return;
      const opt = optionsOf(q).find((a) => a.letra.toLowerCase() === e.key.toLowerCase());
      if (opt) { e.preventDefault(); select(opt.letra); }
      else if (e.key === 'Enter') { e.preventDefault(); void answer(); }
      else if (e.key === 'ArrowRight') go(idx + 1);
      else if (e.key === 'ArrowLeft') go(idx - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (loading) return <div className="glass card" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="spinner" /> Buscando questões da sessão… (na primeira vez, o app liga a sessão aos assuntos do banco de questões)</div>;
  if (!q) return <div className="glass card">{error ? <p className="error" style={{ margin: 0 }}>{error}</p> : <p style={{ margin: 0 }}>{REASON[reason ?? ''] ?? 'Nenhuma questão encontrada.'}</p>}</div>;

  const opts = optionsOf(q);
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
        <button className="icon-btn" onClick={() => go(idx + 1)} disabled={idx >= queue.length - 1} aria-label="Próxima questão"><ChevronRight size={18} /></button>
      </nav>

      <article className="glass q-card">
        <header className="q-meta">
          <strong>Questão {idx + 1}</strong>
          {q.assunto && <span className="badge violet">{q.assunto}</span>}
          {q.prova && <span className="muted small">{[q.prova.banca, q.prova.ano, q.prova.orgao, q.prova.cargo].filter(Boolean).join(' · ')}</span>}
        </header>
        {!!q.textos.length && <details className="q-texts"><summary>Texto associado</summary>{q.textos.map((t, i) => <div key={i} dangerouslySetInnerHTML={safe(t)} />)}</details>}
        <div className="q-body" dangerouslySetInnerHTML={safe(q.enunciado)} />
        {q.anexos.map((src) => <img key={src} className="q-img" src={src} alt="Imagem da questão" loading="lazy" referrerPolicy="no-referrer" />)}

        <div className="q-options" role="radiogroup" aria-label="Alternativas">
          {opts.map((a) => {
            const struck = st.struck.includes(a.letra);
            const state = st.result ? (sameAnswer(a.letra, st.result.gabarito) ? ' right' : st.chosen === a.letra ? ' wrong' : ' dim') : st.chosen === a.letra ? ' picked' : '';
            return (
              <div key={a.letra} className={'q-opt-row' + (struck ? ' struck' : '')}>
                <button role="radio" aria-checked={st.chosen === a.letra} className={'q-opt' + state} disabled={!!st.result || struck} onClick={() => select(a.letra)}>
                  <b>{a.letra}</b><span className="q-opt-text" dangerouslySetInnerHTML={safe(a.texto)} />
                  {a.imagens.map((src) => <img key={src} className="q-img" src={src} alt="" loading="lazy" referrerPolicy="no-referrer" />)}
                </button>
                {!st.result && (
                  <button className={'q-strike' + (struck ? ' on' : '')} onClick={() => strike(a.letra)} title={struck ? 'Desfazer' : 'Tachar: marcar como errada'} aria-label={struck ? `Desfazer tachado da ${a.letra}` : `Tachar a alternativa ${a.letra}`}>
                    <Scissors size={15} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {st.result ? (
          <div className={'q-result ' + (st.result.correct ? 'ok' : 'bad')}>
            {st.result.correct ? <><CheckCircle2 size={20} /> Você acertou!</> : <><XCircle size={20} /> Resposta certa: {st.result.gabarito}</>}
            <div style={{ flex: 1 }} />
            {idx < queue.length - 1 && <button className="btn sm" onClick={() => go(idx + 1)}>Próxima <ChevronRight size={15} /></button>}
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

        {tab === 'explicacao' && st.result && (st.explanation ? (
          <section className="q-explain">
            <p><Lightbulb size={16} style={{ verticalAlign: -3, color: 'var(--orange)' }} /> {st.explanation.resumo}</p>
            <ul>{st.explanation.alternativas.map((a) => <li key={a.letra}><b>{a.letra})</b> {a.comentario}</li>)}</ul>
            {st.explanation.dica && <p className="muted"><b>Atenção:</b> {st.explanation.dica}</p>}
            <p className="faint small"><BookOpenCheck size={13} style={{ verticalAlign: -2 }} /> {st.explanation.artigos.length ? `Base legal: ${st.explanation.artigos.join('; ')} (texto oficial na aba Lei seca).` : 'Explicação sem citação de artigos (nenhum trecho de lei correspondente).'} Gerada por IA a partir do gabarito oficial; confira.</p>
          </section>
        ) : <button className="btn ghost sm" style={{ justifySelf: 'start' }} disabled={busy === 'explain'} onClick={explain}>{busy === 'explain' ? <><span className="spinner" /> Explicando…</> : <><Sparkles size={15} /> Explicar com IA</>}</button>)}

        {tab === 'mnemonico' && st.result && (st.mnemonic === undefined
          ? <button className="btn ghost sm" style={{ justifySelf: 'start' }} disabled={busy === 'mnemonic'} onClick={mnemonic}>{busy === 'mnemonic' ? <><span className="spinner" /> Pensando…</> : <><Brain size={15} /> Ver mnemônico</>}</button>
          : st.mnemonic === null ? <p className="muted" style={{ margin: 0 }}>Esta questão não pede memorização (é de interpretação, raciocínio ou um detalhe isolado): um mnemônico seria forçado.</p>
          : (
            <section className="q-mnemonic">
              <span className="faint small">{st.mnemonic.concept}</span>
              <strong className="q-mnemonic-word">{st.mnemonic.mnemonic}</strong>
              {!!st.mnemonic.items.length && <ul>{st.mnemonic.items.map((it, i) => <li key={i}><b>{it.chave}</b> {it.significado}</li>)}</ul>}
              {st.mnemonic.explanation && <p className="muted" style={{ margin: 0 }}>{st.mnemonic.explanation}</p>}
              <span className="faint small">Mnemônico gerado por IA e compartilhado entre questões do mesmo conceito; confira com a lei.</span>
            </section>
          ))}

        {tab === 'anotacoes' && <NoteBox qid={q.qid} />}
        {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      </article>
      <p className="faint small" style={{ margin: 0 }}>Questões do banco Quest API{info?.assuntos.length ? ` · assuntos desta sessão: ${info.assuntos.slice(0, 3).join(', ')}` : ''}.</p>
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
