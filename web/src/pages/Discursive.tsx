import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, CircleDashed, PenLine, RotateCcw, Sparkles, Trash2, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { countWords, MAX_CHARS, MIN_WORDS, WORDS_PER_LINE, type DiscursiveRules } from '../../../shared/ai/discursive.ts';
import { Shell } from '../components/Shell.tsx';
import { fmtDate } from '../components/ui.tsx';
import { deleteDiscursive, discursiveStats, gradeDiscursive, rewriteDiscursive, saveDraft, startDiscursive, STUCK_MS, useDiscursiveAnswers, useDiscursiveRules, type DiscursiveAnswer } from '../lib/discursive.ts';
import { useActivePlan } from '../lib/plans.ts';

const CRITERIA: Record<'conteudo' | 'estrutura' | 'linguagem', string> = { conteudo: 'Conteúdo', estrutura: 'Estrutura', linguagem: 'Linguagem' };
const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const fmtPoints = (n: number | null) => (n == null ? '—' : String(n).replace('.', ','));

// Treino de discursivas: o enunciado sai do edital e do cronograma; a resposta fica salva até a correção.
export function DiscursivePage() {
  const active = useActivePlan();
  const noticeId = active.data?.notice.id;
  const rules = useDiscursiveRules(noticeId);
  const answers = useDiscursiveAnswers(noticeId);
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const open = answers.data?.find((a) => a.id === params.get('id'));
  const goTo = (id: string | null) => setParams(id ? { id } : {});
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['discursive-answers'] }), qc.invalidateQueries({ queryKey: ['discursive-last'] })]);

  const subtitle = 'Escreva, receba a correção e reescreva até dominar a estrutura.';
  if (active.isLoading || rules.isLoading || answers.isLoading) return <Shell title="Discursivas" subtitle={subtitle}><div className="spinner" /></Shell>;
  if (!active.data) return <Shell title="Discursivas" subtitle={subtitle}><div className="glass card muted">Monte o cronograma primeiro: os temas vêm das sessões dele.</div></Shell>;
  if (!rules.data?.rules) return <Shell title="Discursivas" subtitle={subtitle}><div className="glass card muted">O edital de {active.data.notice.role_name} não tem prova discursiva. Se isso estiver errado, confira o edital em Concursos.</div></Shell>;

  if (open) {
    const back = <button className="btn ghost sm" onClick={() => goTo(null)}><ArrowLeft size={15} /> Treinos</button>;
    return open.status === 'graded'
      ? <Shell title={open.title} subtitle={open.subject_name || 'Redação'} actions={back}><Result answer={open} passPct={rules.data.scale!.passPct} history={answers.data!.filter((a) => a.prompt_id === open.prompt_id && a.status === 'graded')} onOpen={goTo} refresh={refresh} /></Shell>
      : <Shell title={open.title} subtitle={open.subject_name || 'Redação'} actions={back}><Editor key={open.id} answer={open} refresh={refresh} onLeave={() => goTo(null)} /></Shell>;
  }
  return <Shell title="Discursivas" subtitle={subtitle}><Start rules={rules.data.rules} scale={rules.data.scale!} noticeId={noticeId!} answers={answers.data ?? []} subjects={active.data.subjects} onOpen={goTo} refresh={refresh} /></Shell>;
}

function Start({ rules, scale, noticeId, answers, subjects, onOpen, refresh }: {
  rules: DiscursiveRules; scale: { max: number; passPct: number | null }; noticeId: string; answers: DiscursiveAnswer[];
  subjects: { id: string; name: string; is_core: boolean }[]; onOpen: (id: string) => void; refresh: () => Promise<unknown>;
}) {
  const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stats = discursiveStats(answers);
  const specific = subjects.filter((s) => s.is_core);
  const options = rules.specificOnly && specific.length ? specific : subjects;

  async function start() {
    setBusy(true); setError('');
    try { const { id } = await startDiscursive(noticeId, subject || null); await refresh(); onOpen(id); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function remove(a: DiscursiveAnswer) {
    if (!confirm(`Apagar o treino "${a.title}"? Isso não pode ser desfeito.`)) return;
    try { await deleteDiscursive(a.id); await refresh(); } catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="hero">
        <span className="badge violet"><PenLine size={12} /> {rules.format === 'redacao' ? 'Redação' : `${rules.items} ${rules.items === 1 ? 'questão' : 'questões'} na prova`}</span>
        <h2 style={{ fontSize: 24, margin: '14px 0 6px' }}>Novo treino</h2>
        <p className="muted" style={{ margin: '0 0 16px', maxWidth: 620 }}>
          {rules.maxPoints ? `Pelo edital, a prova vale ${fmtPoints(rules.maxPoints)} pontos` : 'O edital não informa a nota da prova'}
          {rules.minPoints ? `, com mínimo de ${fmtPoints(rules.minPoints)} (${scale.passPct}%).` : '.'}
          {rules.format === 'questao' ? ' O tema vem do que você já estudou, priorizando o que menos treinou.' : ' Cada treino traz um tema novo.'}
        </p>
        <div className="disc-start">
          {rules.format === 'questao' && (
            <label className="field">Matéria
              <select className="select" value={subject} onChange={(e) => setSubject(e.target.value)}>
                <option value="">Escolher por mim</option>
                {options.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          )}
          <button className="btn" onClick={start} disabled={busy}><Sparkles size={16} /> {busy ? 'Criando enunciado…' : 'Gerar enunciado'}</button>
        </div>
        {error && <p className="error" role="alert" style={{ margin: '12px 0 0' }}>{error}</p>}
      </div>

      {stats && (
        <div className="disc-stats">
          <div className="glass card"><strong>{stats.count}</strong><span className="muted small">treinos corrigidos</span></div>
          <div className="glass card"><strong>{stats.avgPct}%</strong><span className="muted small">média geral</span></div>
          <div className="glass card"><strong>{stats.recentPct}%</strong><span className="muted small">últimos 5 treinos</span></div>
          <div className="glass card"><strong>{CRITERIA[stats.weakest.key]}</strong><span className="muted small">critério mais fraco ({stats.weakest.pct}%)</span></div>
        </div>
      )}

      <div className="section-title"><h2>Seus treinos</h2></div>
      {!answers.length && <div className="glass card muted">Nenhum treino ainda.</div>}
      {answers.map((a) => (
        <div key={a.id} className="glass card material-row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>{a.title}</strong>
            <div className="muted small">{[a.subject_name, fmtDate(a.created_at.slice(0, 10)), a.attempt > 1 ? `${a.attempt}ª versão` : ''].filter(Boolean).join(' · ')}</div>
          </div>
          {a.status === 'graded'
            ? <span className={'badge ' + (scale.passPct != null && (a.pct ?? 0) >= scale.passPct ? 'lime' : 'orange')}>{a.pct}%</span>
            : <span className="badge">{a.status === 'failed' ? 'Correção falhou' : a.status === 'grading' ? 'Corrigindo…' : 'Rascunho'}</span>}
          <button className="btn ghost sm" onClick={() => onOpen(a.id)}>Abrir</button>
          <button className="icon-btn" title="Apagar" aria-label={`Apagar ${a.title}`} onClick={() => remove(a)}><Trash2 size={16} /></button>
        </div>
      ))}
    </div>
  );
}

function Statement({ answer }: { answer: DiscursiveAnswer }) {
  return (
    <div className="glass card">
      <p className="disc-text" style={{ margin: 0 }}>{answer.statement}</p>
      {answer.support_texts.map((t, i) => <blockquote key={i} className="disc-support">{t}</blockquote>)}
    </div>
  );
}

// Rascunho salvo sozinho a cada pausa na digitação; o tempo só corre com a aba visível.
function Editor({ answer, refresh, onLeave }: { answer: DiscursiveAnswer; refresh: () => Promise<unknown>; onLeave: () => void }) {
  const [body, setBody] = useState(answer.body);
  const [seconds, setSeconds] = useState(answer.seconds);
  const [saved, setSaved] = useState<'saved' | 'saving' | 'error'>('saved');
  const [grading, setGrading] = useState(answer.status === 'grading');
  const [error, setError] = useState(answer.status === 'failed' ? 'A última correção falhou. Seu texto está salvo; tente de novo.' : '');
  const latest = useRef({ body, seconds, sent: answer.body });
  latest.current.body = body; latest.current.seconds = seconds;
  const words = countWords(body);
  // Correção interrompida: o texto segue travado, mas pode ser enviado de novo.
  const stuck = answer.status === 'grading' && !grading && Date.now() - new Date(answer.updated_at).getTime() > STUCK_MS;
  const locked = answer.status === 'grading' || grading;

  useEffect(() => {
    if (locked) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible' && latest.current.body.trim()) setSeconds((s) => s + 1); }, 1000);
    return () => clearInterval(t);
  }, [locked]);

  async function flush() {
    const { body: b, seconds: s, sent } = latest.current;
    if (b === sent) return;
    setSaved('saving');
    try { await saveDraft(answer.id, b, s); latest.current.sent = b; setSaved('saved'); } catch { setSaved('error'); }
  }
  useEffect(() => {
    if (locked || body === latest.current.sent) return;
    const t = setTimeout(flush, 1200);
    return () => clearTimeout(t);
  }, [body, locked]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { void flush(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function grade() {
    setGrading(true); setError('');
    try {
      if (!stuck) await saveDraft(answer.id, body, seconds);
      latest.current.sent = body;
      await gradeDiscursive(answer.id);
    } catch (e) { setError((e as Error).message); setGrading(false); }
    await refresh();
  }
  async function discard() {
    if (!confirm('Apagar este rascunho? O texto não pode ser recuperado.')) return;
    try { await deleteDiscursive(answer.id); latest.current.sent = latest.current.body; await refresh(); onLeave(); }
    catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="grid" style={{ gap: 14 }}>
      <Statement answer={answer} />
      <textarea className="textarea disc-editor" aria-label="Sua resposta" placeholder="Escreva sua resposta como faria na prova." value={body} maxLength={MAX_CHARS} disabled={locked} onChange={(e) => setBody(e.target.value)} />
      <div className="disc-bar">
        <span className="chip">{clock(seconds)}</span>
        <span className="chip">{words} palavras · cerca de {Math.ceil(words / WORDS_PER_LINE)} de {answer.lines_hint} linhas</span>
        <span className="muted small" role="status">{saved === 'saving' ? 'Salvando…' : saved === 'error' ? 'Não foi possível salvar. Copie seu texto.' : 'Salvo'}</span>
        <div className="nav-spacer" />
        <button className="btn ghost sm" onClick={discard} disabled={locked}>Apagar</button>
        <button className="btn sm" onClick={grade} disabled={(locked && !stuck) || words < MIN_WORDS} title={words < MIN_WORDS ? `Escreva ao menos ${MIN_WORDS} palavras` : undefined}>{stuck ? 'Tentar corrigir de novo' : locked ? 'Corrigindo, leva até 1 minuto…' : 'Corrigir'}</button>
      </div>
      {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
    </div>
  );
}

const SITUATION = {
  atendido: { Icon: CheckCircle2, color: 'var(--lime)', label: 'Atendido' },
  parcial: { Icon: CircleDashed, color: 'var(--orange)', label: 'Parcial' },
  ausente: { Icon: XCircle, color: 'var(--danger)', label: 'Ausente' },
} as const;

function Result({ answer, passPct, history, onOpen, refresh }: {
  answer: DiscursiveAnswer; passPct: number | null; history: DiscursiveAnswer[]; onOpen: (id: string) => void; refresh: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const r = answer.report!;
  const pct = answer.pct ?? 0;
  const passed = passPct != null && pct >= passPct;
  const versions = [...history].sort((a, b) => a.attempt - b.attempt);

  async function rewrite() {
    setBusy(true); setError('');
    try { const { id } = await rewriteDiscursive(answer.id); await refresh(); onOpen(id); } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="hero disc-score">
        <div>
          <strong style={{ color: passed ? 'var(--lime)' : 'var(--orange)' }}>{fmtPoints(answer.points)}<small> / {fmtPoints(answer.max_points)}</small></strong>
          <div className="muted small">{pct}%{passPct != null ? ` · mínimo do edital: ${passPct}%` : ''} · {clock(answer.seconds)}</div>
        </div>
        <div style={{ flex: 1, minWidth: 220, display: 'grid', gap: 9 }}>
          {(['conteudo', 'estrutura', 'linguagem'] as const).map((k) => (
            <div key={k} className="small">
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{CRITERIA[k]} <span className="muted">(peso {Math.round(r.criterios[k].peso * 100)}%)</span></span><span>{r.criterios[k].pct}%</span></div>
              <div className="bar" style={{ marginTop: 4 }}><span style={{ width: `${r.criterios[k].pct}%`, background: r.criterios[k].pct >= 60 ? 'var(--lime)' : 'var(--orange)' }} /></div>
            </div>
          ))}
        </div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>Nota estimada pela IA. Os pesos são do app, não da banca, e servem para acompanhar sua evolução, não para prever a nota oficial.</p>

      {r.fora_do_tema && <div className="glass card" role="alert" style={{ color: 'var(--danger)' }}>A resposta foi considerada fora do tema, e por isso a nota é zero.</div>}
      <div className="glass card"><span className="badge orange">Prioridade do próximo treino</span><p style={{ margin: '10px 0 0' }}>{r.prioridade}</p></div>

      {versions.length > 1 && (
        <div className="glass card disc-versions">
          <strong className="small">Versões</strong>
          {versions.map((v) => <button key={v.id} className={'btn sm ' + (v.id === answer.id ? '' : 'ghost')} onClick={() => onOpen(v.id)}>{v.attempt}ª: {v.pct}%</button>)}
        </div>
      )}

      <Statement answer={answer} />

      <div className="section-title"><h2>Pontos esperados</h2></div>
      <div className="grid" style={{ gap: 10 }}>
        {r.pontos.map((p, i) => {
          const s = SITUATION[p.situacao];
          return (
            <div key={i} className="glass card disc-point">
              <s.Icon size={18} style={{ color: s.color, flexShrink: 0, marginTop: 2 }} aria-hidden />
              <div>
                <strong className="small" style={{ color: s.color }}>{s.label}</strong>
                <div>{p.ponto}</div>
                {p.comentario && <div className="muted small" style={{ marginTop: 4 }}>{p.comentario}</div>}
                {!!p.fundamento.length && <div className="small" style={{ marginTop: 4, color: 'var(--cyan)' }}>{p.fundamento.join(' · ')}</div>}
              </div>
            </div>
          );
        })}
      </div>

      {!!r.trechos.length && <>
        <div className="section-title"><h2>Trechos para melhorar</h2></div>
        <div className="grid" style={{ gap: 10 }}>
          {r.trechos.map((t, i) => (
            <div key={i} className="glass card">
              <blockquote className="disc-support" style={{ marginTop: 0 }}>{t.trecho}</blockquote>
              <div className="small">{t.problema}</div>
              <div className="small" style={{ color: 'var(--lime)', marginTop: 4 }}>{t.sugestao}</div>
            </div>
          ))}
        </div>
      </>}

      <div className="glass card small">
        <strong>Estrutura:</strong> {r.criterios.estrutura.comentario}
        <div style={{ marginTop: 8 }}><strong>Linguagem:</strong> {r.criterios.linguagem.comentario}</div>
        {!!r.pontos_fortes.length && <div style={{ marginTop: 8 }}><strong>Pontos fortes:</strong> {r.pontos_fortes.join(' ')}</div>}
      </div>
      {!!r.unverified.length && <p className="muted small" style={{ margin: 0 }}>Não conferido na lei seca: {r.unverified.join(', ')}. Confira antes de usar.</p>}

      <details className="glass card"><summary>Sua resposta</summary><p className="disc-text">{answer.body}</p></details>
      <details className="glass card"><summary>Resposta modelo</summary><p className="disc-text">{r.resposta_modelo}</p></details>

      <div className="disc-bar">
        <Link className="btn ghost sm" to="/discursivas">Novo treino</Link>
        <div className="nav-spacer" />
        <button className="btn sm" onClick={rewrite} disabled={busy}><RotateCcw size={15} /> {busy ? 'Abrindo…' : 'Reescrever'}</button>
      </div>
      {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
    </div>
  );
}
