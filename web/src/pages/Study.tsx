import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, Check, ExternalLink, FileText, ListChecks, Pause, Play, RotateCcw, Scale, Settings2, Target, Video } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { evaluate } from '../../../shared/domain/adaptive.ts';
import { LawReader } from '../components/LawReader.tsx';
import { Shell } from '../components/Shell.tsx';
import { fmtDate, subjectColor, SubjectIcon } from '../components/ui.tsx';
import { KIND_LABEL, setTaskDone } from '../lib/plans.ts';
import { sessionLawRefs } from '../lib/legal.ts';
import { accuracy, addQuestionLog, questionsUrl, saveFilter, saveTimeSpent, useStudy, type Provider, type StudyData } from '../lib/study.ts';

const fmtClock = (s: number) => `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ':' : ''}${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const TABS = [
  { key: 'questoes', label: 'Questões', icon: ListChecks },
  { key: 'roteiro', label: 'Roteiro e apostila', icon: BookOpen, soon: 'E4.3' },
  { key: 'lei', label: 'Lei seca', icon: Scale },
  { key: 'videos', label: 'Vídeos', icon: Video, soon: 'E4.4' },
  { key: 'material', label: 'Meus PDFs', icon: FileText, soon: 'E4.5' },
] as const;
const soonOf = (key: string) => { const t = TABS.find((x) => x.key === key); return t && 'soon' in t ? t.soon : ''; };

// Cronômetro da sessão: soma ao tempo já estudado e salva a cada 30 s, ao pausar e ao sair.
function useTimer(taskId: string, initial: number) {
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(initial);
  const ref = useRef({ seconds: initial, saved: initial });
  useEffect(() => { ref.current = { seconds: initial, saved: initial }; setSeconds(initial); }, [taskId, initial]);
  const flush = useCallback(() => {
    if (Math.abs(ref.current.seconds - ref.current.saved) >= 1) { ref.current.saved = ref.current.seconds; void saveTimeSpent(taskId, ref.current.seconds); }
  }, [taskId]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { ref.current.seconds += 1; setSeconds(ref.current.seconds); if (ref.current.seconds % 30 === 0) flush(); }, 1000);
    return () => clearInterval(t);
  }, [running, flush]);
  useEffect(() => () => flush(), [flush]);
  return { running, seconds, toggle: () => { if (running) flush(); setRunning(!running); }, start: () => setRunning(true) };
}

export function StudyPage() {
  const { taskId } = useParams();
  const study = useStudy(taskId);
  if (study.isError) return <Shell title="Estudo"><p className="error">{(study.error as Error).message}</p></Shell>;
  if (!study.data) return <Shell title="Estudo"><div className="spinner" /></Shell>;
  return <StudyView d={study.data} />;
}

function StudyView({ d }: { d: StudyData }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const timer = useTimer(d.task.id, d.task.time_spent_sec);
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('questoes');
  const [awaiting, setAwaiting] = useState<{ provider: Provider; at: number } | null>(null);
  const [showRegister, setShowRegister] = useState(false);
  const color = d.subjectIndex >= 0 ? subjectColor(d.subjectIndex) : 'var(--magenta)';
  const taskLogs = d.logs.filter((l) => l.task_id === d.task.id);
  const doneQ = taskLogs.reduce((a, l) => a + l.total, 0), rightQ = taskLogs.reduce((a, l) => a + l.correct, 0);
  const subjectAcc = accuracy(d.logs), verdict = evaluate(taskLogs.length ? rightQ / doneQ : null);
  const refresh = () => qc.invalidateQueries();

  // Ao voltar do site de questões, pergunta o resultado na hora.
  useEffect(() => {
    const onBack = () => { if (document.visibilityState === 'visible' && awaiting && Date.now() - awaiting.at > 15000) { setShowRegister(true); } };
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('focus', onBack);
    return () => { document.removeEventListener('visibilitychange', onBack); window.removeEventListener('focus', onBack); };
  }, [awaiting]);

  const open = (provider: Provider, mode: 'not_resolved' | 'wrong') => {
    window.open(questionsUrl(d, provider, mode), '_blank', 'noopener,noreferrer');
    setAwaiting({ provider, at: Date.now() });
    if (!timer.running) timer.start();
  };

  async function toggleDone() { await setTaskDone(d.task.id, !d.task.done_at); await refresh(); }

  const rail = (
    <>
      <section>
        <h3>Tempo de estudo</h3>
        <div className="glass card timer">
          <strong style={{ color: timer.running ? 'var(--cyan)' : 'var(--text)' }}>{fmtClock(timer.seconds)}</strong>
          <span className="muted small">previsto: {fmtClock(d.task.minutes * 60)}</span>
          <div className="bar"><span style={{ width: `${Math.min(100, (timer.seconds / Math.max(60, d.task.minutes * 60)) * 100)}%`, background: 'var(--cyan)', boxShadow: '0 0 10px var(--cyan)' }} /></div>
          <button className={'btn' + (timer.running ? ' ghost' : '')} onClick={timer.toggle}>{timer.running ? <><Pause size={18} /> Pausar</> : <><Play size={18} /> {timer.seconds ? 'Continuar' : 'Começar'}</>}</button>
        </div>
      </section>
      <section>
        <h3>Questões</h3>
        <div className="stats">
          <div className="stat"><strong style={{ color: 'var(--violet)' }}>{doneQ}</strong><span>de {d.task.goal_questions || '—'}</span></div>
          <div className="stat"><strong style={{ color: 'var(--lime)' }}>{doneQ ? Math.round((rightQ / doneQ) * 100) + '%' : '—'}</strong><span>acerto hoje</span></div>
          <div className="stat"><strong style={{ color: 'var(--orange)' }}>{subjectAcc != null ? Math.round(subjectAcc * 100) + '%' : '—'}</strong><span>na matéria</span></div>
        </div>
      </section>
      <section>
        <button className={'btn' + (d.task.done_at ? ' ghost' : ' light')} style={{ width: '100%' }} onClick={toggleDone}>
          <Check size={18} /> {d.task.done_at ? 'Concluída · desfazer' : 'Concluir tarefa'}
        </button>
      </section>
    </>
  );

  return (
    <Shell title={d.subject?.name ?? KIND_LABEL[d.task.kind] ?? 'Estudo'} subtitle={`${fmtDate(d.task.date)} · ${KIND_LABEL[d.task.kind] ?? ''}`} rail={rail}
      actions={<button className="btn ghost sm" onClick={() => navigate(-1)}>Voltar</button>}>
      <div className="hero" style={{ borderColor: `color-mix(in srgb, ${color} 45%, transparent)` }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          {d.subject && <SubjectIcon name={d.subject.name} index={d.subjectIndex} />}
          <h2 style={{ margin: 0, fontSize: 24, lineHeight: 1.25 }}>{d.task.title}</h2>
        </div>
        {!!d.topics.length && (
          <details style={{ marginTop: 16 }}>
            <summary className="muted" style={{ cursor: 'pointer' }}>Conteúdo do edital desta sessão ({d.topics.length})</summary>
            <ul className="advice" style={{ marginTop: 10 }}>{d.topics.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </details>
        )}
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={'tab' + (tab === t.key ? ' on' : '')} onClick={() => setTab(t.key)}>
            <t.icon size={16} /> {t.label}{'soon' in t && <span className="badge" style={{ marginLeft: 6 }}>{t.soon}</span>}
          </button>
        ))}
      </div>

      {tab === 'questoes' ? (
        <div className="grid" style={{ gap: 16 }}>
          <div className="glass card" style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <strong><Target size={16} style={{ verticalAlign: -2, color: 'var(--violet)' }} /> Meta: {d.task.goal_questions || '—'} questões</strong>
              {!!doneQ && <span className={'badge ' + (verdict.level === 'ok' ? 'lime' : verdict.level === 'warning' ? 'orange' : verdict.level === 'bad' ? 'orange' : '')}>{verdict.text}</span>}
            </div>
            {d.task.goal_questions > 0 && <div className="bar"><span style={{ width: `${Math.min(100, (doneQ / d.task.goal_questions) * 100)}%`, background: 'var(--violet)', boxShadow: '0 0 10px var(--violet)' }} /></div>}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => open('qconcursos', 'not_resolved')}><ExternalLink size={16} /> Resolver no QConcursos</button>
              {doneQ > rightQ && <button className="btn ghost" onClick={() => open('qconcursos', 'wrong')}><RotateCcw size={16} /> Refazer as que errei</button>}
              <button className="btn ghost" onClick={() => open('tecconcursos', 'not_resolved')}><ExternalLink size={16} /> TecConcursos</button>
            </div>
            <p className="faint small" style={{ margin: 0 }}>
              Abre em outra aba com o filtro pronto{d.task.keyword ? ` (assunto: ${d.task.keyword})` : ''}. Questões do QConcursos e do TecConcursos pertencem a eles; faça login lá. Quando voltar, o app pergunta o resultado.
            </p>
          </div>
          <RegisterForm d={d} provider={awaiting?.provider ?? 'qconcursos'} onSaved={() => { setAwaiting(null); setShowRegister(false); void refresh(); }} highlight={showRegister} />
          {!!taskLogs.length && (
            <div className="glass card">
              <strong>Registros desta tarefa</strong>
              <ul className="advice" style={{ marginTop: 10 }}>{taskLogs.map((l) => <li key={l.id}>{new Date(l.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {l.correct}/{l.total} ({Math.round((l.correct / l.total) * 100)}%) · {l.source}</li>)}</ul>
            </div>
          )}
          <FiltersConfig d={d} onSaved={refresh} />
        </div>
      ) : tab === 'lei' ? (
        <LawReader refs={sessionLawRefs(d.task.title, d.topics, d.subject?.name ?? '')} />
      ) : (
        <div className="glass card muted">Chega na etapa {soonOf(tab)}.</div>
      )}
    </Shell>
  );
}

function RegisterForm({ d, provider, onSaved, highlight }: { d: StudyData; provider: Provider; onSaved: () => void; highlight: boolean }) {
  const [right, setRight] = useState('');
  const [wrong, setWrong] = useState('');
  const [source, setSource] = useState<Provider | 'outro'>(provider);
  const [error, setError] = useState('');
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { setSource(provider); }, [provider]);
  useEffect(() => { if (highlight) first.current?.focus(); }, [highlight]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const c = Number(right) || 0, w = Number(wrong) || 0;
    if (c + w < 1) return setError('Informe quantas acertou e quantas errou.');
    setError('');
    try { await addQuestionLog(d, c, c + w, source); setRight(''); setWrong(''); onSaved(); } catch (err) { setError((err as Error).message); }
  }
  return (
    <form className={'glass card register' + (highlight ? ' pulse-border' : '')} onSubmit={submit}>
      <strong>{highlight ? 'Como foi? Registre o resultado' : 'Registrar questões'}</strong>
      <div className="row">
        <label className="field" style={{ flex: '0 1 130px' }}>Acertei<input ref={first} className="input" type="number" min={0} inputMode="numeric" value={right} onChange={(e) => setRight(e.target.value)} /></label>
        <label className="field" style={{ flex: '0 1 130px' }}>Errei<input className="input" type="number" min={0} inputMode="numeric" value={wrong} onChange={(e) => setWrong(e.target.value)} /></label>
        <label className="field" style={{ flex: '0 1 170px' }}>Onde
          <select className="select" value={source} onChange={(e) => setSource(e.target.value as Provider | 'outro')}>
            <option value="qconcursos">QConcursos</option><option value="tecconcursos">TecConcursos</option><option value="outro">Outro</option>
          </select>
        </label>
        <button className="btn">Salvar</button>
      </div>
      {error && <span className="error">{error}</span>}
    </form>
  );
}

function FiltersConfig({ d, onSaved }: { d: StudyData; onSaved: () => void }) {
  const [provider, setProvider] = useState<Provider>('qconcursos');
  const current = (subjectId: string | null) => d.filters.find((f) => f.provider === provider && f.subject_id === subjectId)?.url ?? '';
  const [own, setOwn] = useState(current(d.task.subject_id));
  const [base, setBase] = useState(current(null));
  const [msg, setMsg] = useState('');
  useEffect(() => { setOwn(current(d.task.subject_id)); setBase(current(null)); }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    try {
      if (d.task.subject_id) await saveFilter(d.task.plan_id, d.task.subject_id, provider, own);
      await saveFilter(d.task.plan_id, null, provider, base);
      setMsg('Filtros salvos.'); onSaved();
    } catch (e) { setMsg((e as Error).message); }
  }
  return (
    <details className="glass card">
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}><Settings2 size={16} style={{ verticalAlign: -3 }} /> Filtros salvos</summary>
      <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
        <p className="muted small" style={{ margin: 0 }}>No site, monte o filtro (banca, cargo, anos…), copie o link da barra do navegador e cole aqui. O app troca só o assunto, o modo e a dificuldade.</p>
        <div className="segmented" style={{ justifySelf: 'start' }}>
          {(['qconcursos', 'tecconcursos'] as const).map((p) => <button key={p} type="button" className={provider === p ? 'on' : ''} onClick={() => setProvider(p)}>{p === 'qconcursos' ? 'QConcursos' : 'TecConcursos'}</button>)}
        </div>
        {d.subject && <label className="field">Filtro de {d.subject.name}<input className="input" value={own} onChange={(e) => setOwn(e.target.value)} placeholder="https://..." /></label>}
        <label className="field">Filtro base do concurso (banca, cargo, anos)<input className="input" value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://..." /></label>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><button type="button" className="btn sm" onClick={save}>Salvar filtros</button>{msg && <span className="muted small">{msg}</span>}</div>
      </div>
    </details>
  );
}
