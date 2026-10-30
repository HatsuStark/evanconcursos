import { useQueryClient } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import { ArrowRight, BookOpenCheck, CheckCircle2, Lightbulb, Sparkles, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { answerQuestion, explainQuestion, nextQuestions, optionsOf, sameAnswer, type Explanation, type NextResult, type Question } from '../lib/questions.ts';

// HTML das questões vem de fora: sempre limpo antes de exibir (sem scripts, eventos ou iframes).
const safe = (html: string) => ({ __html: DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'iframe', 'form', 'input'] }) });

const REASON: Record<string, string> = {
  'sem-materia': 'Esta tarefa não tem matéria para buscar questões.',
  'sem-assunto': 'Não encontramos no banco de questões assuntos que correspondam a esta sessão. Estude pela lei seca e pelo roteiro.',
  esgotado: 'Você já respondeu todas as questões disponíveis para esta sessão. Ótimo trabalho!',
};

// Resolução de questões dentro do app: uma por vez, correção no servidor, explicação sob demanda.
export function QuestionsPanel({ taskId, goal, answered }: { taskId: string; goal: number; answered: number }) {
  const qc = useQueryClient();
  const [queue, setQueue] = useState<Question[]>([]);
  const [idx, setIdx] = useState(0);
  const [info, setInfo] = useState<NextResult['filter'] | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const [result, setResult] = useState<{ correct: boolean; gabarito: string } | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [explaining, setExplaining] = useState(false);
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

  const q = queue[idx];
  // Busca o próximo lote antes de acabar a fila.
  useEffect(() => { if (queue.length && idx >= queue.length - 2 && !reason) void load(); }, [idx, queue.length, reason, load]);

  async function answer(letra: string) {
    if (!q || result) return;
    setChosen(letra);
    try {
      const r = await answerQuestion(taskId, q.qid, letra);
      setResult(r);
      void qc.invalidateQueries({ queryKey: ['study'] });
    } catch (e) { setError((e as Error).message); setChosen(null); }
  }
  async function explain() {
    if (!q) return;
    setExplaining(true);
    try { setExplanation((await explainQuestion(taskId, q.qid)).explanation); } catch (e) { setError((e as Error).message); } finally { setExplaining(false); }
  }
  const next = () => { setIdx(idx + 1); setChosen(null); setResult(null); setExplanation(null); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  if (loading) return <div className="glass card" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="spinner" /> Buscando questões da sessão… (na primeira vez, o app liga a sessão aos assuntos do banco de questões)</div>;
  if (!q) return <div className="glass card">{error ? <p className="error" style={{ margin: 0 }}>{error}</p> : <p style={{ margin: 0 }}>{REASON[reason ?? ''] ?? 'Nenhuma questão encontrada.'}</p>}</div>;

  const opts = optionsOf(q);
  return (
    <div className="grid" style={{ gap: 14 }}>
      {goal > 0 && answered >= goal && (
        <div className="glass card goal-done"><CheckCircle2 size={18} /> Meta de {goal} questões atingida! Você pode concluir a tarefa ou continuar treinando.</div>
      )}
      <article className="glass q-card">
        <header className="q-meta">
          {q.assunto && <span className="badge violet">{q.assunto}</span>}
          {q.prova && <span className="muted small">{[q.prova.banca, q.prova.ano, q.prova.orgao, q.prova.cargo].filter(Boolean).join(' · ')}</span>}
        </header>
        {!!q.textos.length && (
          <details className="q-texts"><summary>Texto associado</summary>{q.textos.map((t, i) => <div key={i} dangerouslySetInnerHTML={safe(t)} />)}</details>
        )}
        <div className="q-body" dangerouslySetInnerHTML={safe(q.enunciado)} />
        {q.anexos.map((src) => <img key={src} className="q-img" src={src} alt="Imagem da questão" loading="lazy" referrerPolicy="no-referrer" />)}
        <div className="q-options" role="radiogroup" aria-label="Alternativas">
          {opts.map((a) => {
            const state = result ? (sameAnswer(a.letra, result.gabarito) ? ' right' : chosen === a.letra ? ' wrong' : ' dim') : chosen === a.letra ? ' picked' : '';
            return (
              <button key={a.letra} role="radio" aria-checked={chosen === a.letra} className={'q-opt' + state} disabled={!!result || !!chosen} onClick={() => answer(a.letra)}>
                <b>{a.letra}</b><span dangerouslySetInnerHTML={safe(a.texto)} />
                {a.imagens.map((src) => <img key={src} className="q-img" src={src} alt="" loading="lazy" referrerPolicy="no-referrer" />)}
              </button>
            );
          })}
        </div>
        {result && (
          <div className={'q-result ' + (result.correct ? 'ok' : 'bad')}>
            {result.correct ? <><CheckCircle2 size={20} /> Você acertou!</> : <><XCircle size={20} /> Resposta certa: {result.gabarito}</>}
            <div style={{ flex: 1 }} />
            {!explanation && <button className="btn ghost sm" disabled={explaining} onClick={explain}>{explaining ? <><span className="spinner" /> Explicando…</> : <><Sparkles size={15} /> Explicar com IA</>}</button>}
            <button className="btn sm" onClick={next}>Próxima <ArrowRight size={15} /></button>
          </div>
        )}
        {explanation && (
          <section className="q-explain">
            <p><Lightbulb size={16} style={{ verticalAlign: -3, color: 'var(--orange)' }} /> {explanation.resumo}</p>
            <ul>{explanation.alternativas.map((a) => <li key={a.letra}><b>{a.letra})</b> {a.comentario}</li>)}</ul>
            {explanation.dica && <p className="muted"><b>Atenção:</b> {explanation.dica}</p>}
            <p className="faint small"><BookOpenCheck size={13} style={{ verticalAlign: -2 }} /> {explanation.artigos.length ? `Base legal: ${explanation.artigos.join('; ')} (texto oficial na aba Lei seca).` : 'Explicação sem citação de artigos (nenhum trecho de lei correspondente).'} Gerada por IA a partir do gabarito oficial; confira.</p>
          </section>
        )}
        {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      </article>
      <p className="faint small" style={{ margin: 0 }}>
        Questões do banco Quest API{info?.assuntos.length ? ` · assuntos desta sessão: ${info.assuntos.slice(0, 3).join(', ')}` : ''}.
      </p>
    </div>
  );
}
