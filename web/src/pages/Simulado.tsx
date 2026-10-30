import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronLeft, ChevronRight, Flag, Timer, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CommentsPanel } from '../components/CommentsPanel.tsx';
import { ErrorReasonPicker } from '../components/ErrorReason.tsx';
import { ExplanationView } from '../components/QuestionsPanel.tsx';
import { QuestionBody } from '../components/QuestionBody.tsx';
import { Shell } from '../components/Shell.tsx';
import { finishSimulado, getSimulado, saveSimAnswer, type SimuladoData } from '../lib/practice.ts';
import { explainQuestion, type Explanation } from '../lib/questions.ts';

const clock = (s: number) => `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ':' : ''}${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

export function SimuladoPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['simulado', id], enabled: !!id, queryFn: () => getSimulado(id!), staleTime: Infinity });
  if (q.isError) return <Shell title="Simulado"><p className="error">{(q.error as Error).message}</p></Shell>;
  if (!q.data) return <Shell title="Simulado"><div className="spinner" /></Shell>;
  return q.data.simulado.status === 'finished' ? <SimuladoResult d={q.data} /> : <SimuladoExam d={q.data} />;
}

// Prova: navegação livre, marcação salva na hora (sem correção), cronômetro regressivo e entrega.
function SimuladoExam({ d }: { d: SimuladoData }) {
  const qc = useQueryClient();
  const { simulado: sim, questions } = d;
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, { chosen: string; struck: string[] }>>(() => Object.fromEntries(d.answers.map((a) => [a.qid, { chosen: a.chosen, struck: a.struck }])));
  const [now, setNow] = useState(Date.now());
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState('');
  const auto = useRef(false);
  const ends = new Date(sim.started_at).getTime() + sim.config.minutes * 60_000;
  const left = Math.round((ends - now) / 1000), elapsed = Math.round((now - new Date(sim.started_at).getTime()) / 1000);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  async function finish(force = false) {
    const blank = questions.length - Object.values(answers).filter((a) => a.chosen).length;
    if (!force && !confirm(blank ? `Entregar com ${blank} questão(ões) em branco?` : 'Entregar o simulado?')) return;
    setFinishing(true);
    try { const r = await finishSimulado(sim.id); qc.setQueryData(['simulado', sim.id], r); void qc.invalidateQueries({ queryKey: ['simulados'] }); }
    catch (e) { setError((e as Error).message); setFinishing(false); }
  }
  // Tempo esgotado: entrega automaticamente.
  useEffect(() => { if (sim.config.timed && left <= 0 && !auto.current) { auto.current = true; void finish(true); } });

  const cur = questions[idx]!, a = answers[cur.qid] ?? { chosen: '', struck: [] };
  const set = (p: Partial<{ chosen: string; struck: string[] }>) => {
    const next = { ...a, ...p };
    setAnswers((s) => ({ ...s, [cur.qid]: next }));
    saveSimAnswer(sim.id, cur.qid, next.chosen, next.struck).catch((e: Error) => setError(e.message));
  };
  const answered = Object.values(answers).filter((x) => x.chosen).length;

  const rail = (
    <>
      <section>
        <h3>{sim.config.timed ? 'Tempo restante' : 'Tempo'}</h3>
        <div className="glass card timer"><strong style={{ color: sim.config.timed && left < 600 ? 'var(--orange)' : 'var(--cyan)' }}>{clock(sim.config.timed ? left : elapsed)}</strong>
          <span className="muted small">{answered} de {questions.length} respondidas</span></div>
      </section>
      <section>
        <h3>Questões</h3>
        <div className="sim-grid">{questions.map((x, i) => <button key={x.qid} className={'q-dot' + (i === idx ? ' on' : '') + (answers[x.qid]?.chosen ? ' picked' : '')} onClick={() => setIdx(i)}>{i + 1}</button>)}</div>
      </section>
      <section><button className="btn light" style={{ width: '100%' }} disabled={finishing} onClick={() => finish()}><Flag size={16} /> {finishing ? 'Corrigindo…' : 'Entregar simulado'}</button></section>
    </>
  );
  return (
    <Shell title={sim.title} subtitle={`${cur.block} · ${cur.subject}`} rail={rail}>
      {!cur.question ? <div className="glass card muted">Questão indisponível.</div> : (
        <article className="glass q-card">
          <QuestionBody q={cur.question} number={idx + 1} chosen={a.chosen || null} struck={a.struck} gabarito={null} locked={false}
            onSelect={(l) => !a.struck.includes(l) && set({ chosen: a.chosen === l ? '' : l })}
            onStrike={(l) => set({ struck: a.struck.includes(l) ? a.struck.filter((x) => x !== l) : [...a.struck, l], chosen: a.chosen === l ? '' : a.chosen })} />
          <div className="q-actions">
            <button className="btn ghost" disabled={idx === 0} onClick={() => setIdx(idx - 1)}><ChevronLeft size={16} /> Anterior</button>
            <button className="btn" disabled={idx >= questions.length - 1} onClick={() => setIdx(idx + 1)}>Próxima <ChevronRight size={16} /></button>
            <span className="faint small">Marcação salva na hora; correção só na entrega.</span>
          </div>
          {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
        </article>
      )}
    </Shell>
  );
}

// Resultado: nota geral e por bloco (com nota mínima do edital), por matéria e revisão com explicações.
function SimuladoResult({ d }: { d: SimuladoData }) {
  const navigate = useNavigate();
  const r = d.simulado.result!;
  const chosenOf = new Map(d.answers.map((a) => [a.qid, a.chosen]));
  const [open, setOpen] = useState<number | null>(null);
  const [ex, setEx] = useState<Record<string, Explanation>>({});
  const [busy, setBusy] = useState('');
  return (
    <Shell title={d.simulado.title} subtitle={`Entregue em ${new Date(d.simulado.finished_at ?? Date.now()).toLocaleString('pt-BR')} · ${clock(r.seconds)}`}
      actions={<button className="btn ghost sm" onClick={() => navigate('/questoes?aba=simulados')}>Simulados</button>}>
      <div className="hero sim-score">
        <div className="stat"><strong style={{ fontSize: 48, color: r.passed ? 'var(--lime)' : 'var(--orange)' }}>{r.pct}%</strong><span>{r.correct} de {r.total} · {r.answered} respondidas</span></div>
        <span className={'badge ' + (r.passed ? 'lime' : 'orange')}>{r.passed ? 'Aprovado nos mínimos do edital' : 'Abaixo do mínimo em algum bloco'}</span>
      </div>
      <div className="section-title"><h2>Por bloco</h2></div>
      <div className="grid" style={{ gap: 10 }}>
        {r.blocks.map((b) => (
          <div key={b.name} className="glass card sim-block">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><strong>{b.name}</strong><span>{b.correct}/{b.total} · {b.pct}%{b.minPct ? ` (mínimo ${b.minPct}%)` : ''}</span></div>
            <div className="bar" style={{ marginTop: 8 }}><span style={{ width: `${b.pct}%`, background: b.passed ? 'var(--lime)' : 'var(--orange)' }} /></div>
          </div>
        ))}
      </div>
      <div className="section-title"><h2>Por matéria</h2></div>
      <table className="sum-table glass"><tbody>{[...r.subjects].sort((a, b) => a.pct - b.pct).map((s) => <tr key={s.name}><td>{s.name}</td><td>{s.correct}/{s.total}</td><td>{s.pct}%</td></tr>)}</tbody></table>
      <div className="section-title"><h2>Revisão</h2><span className="muted small">As erradas já estão no seu caderno de erros.</span></div>
      <div className="grid" style={{ gap: 8 }}>
        {d.questions.map((x, i) => {
          const ch = chosenOf.get(x.qid) ?? '', ok = !!ch && x.gabarito != null && ch.slice(0, 1).toUpperCase() === x.gabarito.slice(0, 1).toUpperCase();
          return (
            <div key={x.qid} className="glass card">
              <button className="link-btn" style={{ margin: 0, fontSize: 15 }} onClick={() => setOpen(open === i ? null : i)}>
                {ok ? <CheckCircle2 size={16} color="var(--lime)" /> : <XCircle size={16} color="var(--danger)" />} Questão {i + 1} · {x.subject} · {ch ? `marcou ${ch}` : 'em branco'} · gabarito {x.gabarito}
              </button>
              {open === i && x.question && (
                <div className="grid" style={{ gap: 12, marginTop: 12 }}>
                  <QuestionBody q={x.question} number={i + 1} chosen={ch || null} struck={[]} gabarito={x.gabarito} locked onSelect={() => {}} onStrike={() => {}} />
                  {!!ch && !ok && <ErrorReasonPicker qid={x.qid} />}
                  <ExplanationView ex={ex[x.qid] ?? null} busy={busy === x.qid} onExplain={async () => { setBusy(x.qid); try { const r2 = await explainQuestion(null, x.qid); setEx((s) => ({ ...s, [x.qid]: r2.explanation })); } finally { setBusy(''); } }} />
                  <h3 style={{ margin: 0, fontSize: 15 }}>Comentários</h3>
                  <CommentsPanel qid={x.qid} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="faint small"><Timer size={12} /> Tempo total: {clock(r.seconds)}.</p>
    </Shell>
  );
}
