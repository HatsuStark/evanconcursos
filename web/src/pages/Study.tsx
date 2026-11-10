import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, Check, FileText, Gavel, ListChecks, Maximize2, Minimize2, Pause, Play, RotateCcw, Scale, ScanSearch, Timer, Video } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { evaluate, latestAnswers, questionScore, scoreGoal } from '../../../shared/domain/adaptive.ts';
import { REVIEW_PREFIX } from '../../../shared/ai/plan-build.ts';
import { DEEP_PREFIX, PRACTICE_PREFIX } from '../../../shared/ai/plan.ts';
import { isWarmupAnswer } from '../../../shared/domain/goals.ts';
import { videoQuery } from '../../../shared/domain/videos.ts';
import { GuidePanel } from '../components/GuidePanel.tsx';
import { JurisPanel } from '../components/JurisPanel.tsx';
import { LawReader } from '../components/LawReader.tsx';
import { PenteFinoPanel } from '../components/PenteFinoPanel.tsx';
import { QuestionsPanel } from '../components/QuestionsPanel.tsx';
import { SessionMaterials } from '../components/SessionMaterials.tsx';
import { SimuladoStarter } from '../components/SimuladoStarter.tsx';
import { Shell } from '../components/Shell.tsx';
import { TheoryReviewCard } from '../components/TheoryReviewCard.tsx';
import { VideosPanel } from '../components/VideosPanel.tsx';
import { fmtDate, subjectColor, SubjectIcon } from '../components/ui.tsx';
import { missingNorms, sessionLawRefs, useOwnLaws } from '../lib/legal.ts';
import { KIND_LABEL, setTaskDone } from '../lib/plans.ts';
import { PRESETS, usePomodoro, type Preset } from '../lib/pomodoro.ts';
import { saveTimeSpent, useStudy, type StudyData } from '../lib/study.ts';

const fmtClock = (s: number) => `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ':' : ''}${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
// Ordem de estudo: teoria primeiro, questões por último. Lei seca e jurisprudência só em assuntos de legislação.
const TABS = [
  { key: 'pente', label: 'Pente-fino', icon: ScanSearch },
  { key: 'apostila', label: 'Apostila', icon: BookOpen },
  { key: 'videos', label: 'Vídeos', icon: Video },
  { key: 'lei', label: 'Lei seca', icon: Scale },
  { key: 'juris', label: 'Jurisprudência', icon: Gavel },
  { key: 'material', label: 'Meus PDFs', icon: FileText },
  { key: 'questoes', label: 'Questões', icon: ListChecks },
] as const;
type TabKey = (typeof TABS)[number]['key'];

// Cronômetro da sessão: soma ao tempo já estudado e salva a cada 30 s, ao pausar e ao sair.
function useTimer(taskId: string, initial: number) {
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(initial);
  const ref = useRef({ taskId, seconds: initial, saved: initial });
  // Recarregar os dados devolve o último tempo salvo: só reinicia em outra tarefa ou se o banco estiver à frente.
  useEffect(() => {
    if (ref.current.taskId === taskId && initial <= ref.current.saved) return;
    ref.current = { taskId, seconds: initial, saved: initial };
    setSeconds(initial);
  }, [taskId, initial]);
  const flush = useCallback(() => {
    if (Math.abs(ref.current.seconds - ref.current.saved) >= 1) { ref.current.saved = ref.current.seconds; void saveTimeSpent(taskId, ref.current.seconds); }
  }, [taskId]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { ref.current.seconds += 1; setSeconds(ref.current.seconds); if (ref.current.seconds % 30 === 0) flush(); }, 1000);
    return () => clearInterval(t);
  }, [running, flush]);
  useEffect(() => () => flush(), [flush]);
  // Zerar: para o cronômetro e grava 0 na hora (o tempo anterior da tarefa se perde).
  const reset = () => {
    setRunning(false);
    ref.current.seconds = 0; ref.current.saved = 0; setSeconds(0);
    void saveTimeSpent(taskId, 0);
  };
  return { running, seconds, reset, pause: () => { flush(); setRunning(false); }, toggle: () => { if (running) flush(); setRunning(!running); } };
}

// Barra flutuante que acompanha a leitura: presa no topo ao rolar, some depois de `delay` ms parada e volta ao rolar
// para cima, ao passar o mouse perto do topo ou ao tocar nela. No lugar de origem (antes de rolar), fica sempre visível.
function useAutoHide(delay = 2500) {
  const ref = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY, timer: number | undefined;
    // Presa: a barra chegou ao topo da tela (o sticky a segura ali).
    const stuck = () => !!ref.current && window.scrollY > 0 && ref.current.getBoundingClientRect().top <= 16;
    const arm = () => { window.clearTimeout(timer); timer = window.setTimeout(() => { if (stuck()) setHidden(true); }, delay); };
    const reveal = () => { setHidden(false); arm(); };
    const onScroll = () => {
      const y = window.scrollY;
      if (y < last - 4 || !stuck()) reveal();
      last = y;
    };
    const onMove = (e: MouseEvent) => { if (e.clientY < 90) reveal(); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('mousemove', onMove, { passive: true });
    arm();
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('mousemove', onMove); window.clearTimeout(timer); };
  }, [delay]);
  return { ref, hidden, reveal: () => setHidden(false) };
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
  const [params] = useSearchParams();
  const timer = useTimer(d.task.id, d.task.time_spent_sec);
  const pomo = usePomodoro(timer);
  const pomoLabel = pomo.enabled ? <span className={'pomo-phase ' + pomo.phase}>{pomo.phase === 'foco' ? 'Foco' : 'Pausa'} {fmtClock(pomo.left)}</span> : null;
  const own = useOwnLaws().data?.entries ?? [];
  const lawRefs = sessionLawRefs(d.task.title, d.topics, d.subject?.name ?? '', own, d.session?.law_refs);
  const missing = missingNorms(d.task.title, own);
  const hasSession = !!d.task.session_id;
  const tabs = TABS.filter((t) => (t.key === 'pente' ? d.task.kind === 'pente_fino' : t.key === 'lei' ? lawRefs.length > 0 || missing.length > 0 : t.key === 'juris' ? lawRefs.length > 0 : t.key === 'apostila' || t.key === 'videos' || t.key === 'material' ? hasSession : true));
  // Lei seca abre direto nos artigos.
  const [tab, setTab] = useState<TabKey>(d.task.kind === 'lei_seca' && tabs.some((t) => t.key === 'lei') ? 'lei' : tabs[0]!.key);
  const [videosOpened, setVideosOpened] = useState(false);
  const floating = useAutoHide();
  const color = d.subjectIndex >= 0 ? subjectColor(d.subjectIndex) : 'var(--magenta)';
  // Meta e desempenho da tarefa: as questões de aquecimento (da sessão anterior) ficam de fora.
  const mine = latestAnswers(d.attempts.filter((a) => a.task_id === d.task.id && !isWarmupAnswer(a, d.task)));
  const right = mine.filter((a) => a.correct).length;
  const verdict = evaluate(mine.length ? right / mine.length : null, scoreGoal(d.cutoffPct));
  const score = questionScore(right, mine.length, d.task.goal_questions);
  // A matéria segue a mesma conta do Edital: questões das sessões, com as pendentes.
  const subjectAnswers = latestAnswers(d.attempts.filter((a) => a.session_id));
  const subjectScore = questionScore(subjectAnswers.filter((a) => a.correct).length, subjectAnswers.length, d.subjectGoal);

  const canFocus = d.task.kind !== 'simulado';
  const [focus, setFocus] = useState(false);
  // Esc sai do foco; o cronômetro continua até pausar.
  useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFocus(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus]);
  // Começar a estudar entra no modo foco (o simulado já tem tela própria).
  function start() {
    if (!timer.running) timer.toggle();
    if (canFocus) setFocus(true);
  }
  function resetTimer() {
    if (window.confirm(`Zerar o cronômetro desta tarefa? Os ${fmtClock(timer.seconds)} registrados serão apagados.`)) timer.reset();
  }
  async function toggleDone() {
    if (focus) { if (timer.running) timer.toggle(); setFocus(false); }
    await setTaskDone(d.task.id, !d.task.done_at);
    await qc.invalidateQueries();
  }

  const tabBar = (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={tab === t.key} className={'tab' + (tab === t.key ? ' on' : '')} onClick={() => { setTab(t.key); if (t.key === 'videos') setVideosOpened(true); }}>
          <t.icon size={16} /> {t.label}
        </button>
      ))}
    </div>
  );

  const rail = (
    <>
      <section>
        <h3>Tempo de estudo</h3>
        <div className="glass card timer">
          <strong style={{ color: timer.running ? 'var(--cyan)' : 'var(--text)' }}>{fmtClock(timer.seconds)}</strong>
          <span className="muted small">previsto: {fmtClock(d.task.minutes * 60)}</span>
          <div className="bar"><span style={{ width: `${Math.min(100, (timer.seconds / Math.max(60, d.task.minutes * 60)) * 100)}%`, background: 'var(--cyan)' }} /></div>
          <button className={'btn' + (timer.running ? ' ghost' : '')} onClick={timer.running ? timer.toggle : start}>{timer.running ? <><Pause size={18} /> Pausar</> : <><Play size={18} /> {timer.seconds ? 'Continuar' : 'Começar'}</>}</button>
          {timer.seconds > 0 && <button className="btn ghost sm" onClick={resetTimer}><RotateCcw size={15} /> Zerar</button>}
          <div className="pomo">
            <label className="check"><input type="checkbox" checked={pomo.enabled} onChange={pomo.toggle} /> <Timer size={15} /> Pomodoro</label>
            {pomo.enabled && (
              <select className="select pomo-preset" value={pomo.preset} onChange={(e) => pomo.setPreset(e.target.value as Preset)} aria-label="Ciclo do Pomodoro">
                {Object.keys(PRESETS).map((k) => <option key={k} value={k}>{k} min</option>)}
              </select>
            )}
          </div>
          {pomo.enabled && (
            <div className="pomo-status">
              {pomoLabel}
              <span className="faint small">{pomo.cycles} {pomo.cycles === 1 ? 'ciclo' : 'ciclos'}</span>
              {pomo.phase === 'pausa' && <button className="btn ghost sm" onClick={pomo.skipBreak}>Pular pausa</button>}
            </div>
          )}
        </div>
      </section>
      <section>
        <h3>Questões</h3>
        <div className="stats">
          <div className="stat"><strong style={{ color: 'var(--violet)' }}>{mine.length}</strong><span>de {d.task.goal_questions || '—'}</span></div>
          <div className="stat"><strong style={{ color: score.pending ? 'var(--cyan)' : 'var(--lime)' }}>{mine.length ? score.pct + '%' : '—'}</strong><span>no tema</span></div>
          <div className="stat"><strong style={{ color: subjectScore.pending ? 'var(--cyan)' : 'var(--orange)' }}>{subjectAnswers.length ? subjectScore.pct + '%' : '—'}</strong><span>na matéria</span></div>
        </div>
        {d.task.goal_questions > 0 && <div className="bar" style={{ marginTop: 12 }}><span style={{ width: `${Math.min(100, (mine.length / d.task.goal_questions) * 100)}%`, background: 'var(--violet)' }} /></div>}
        {!!mine.length && <p className="small" style={{ margin: '10px 0 0' }}>{score.pending
          ? <span className="badge violet">Tema incompleto: {score.pending} {score.pending === 1 ? 'pendente' : 'pendentes'}</span>
          : <span className={'badge ' + (verdict.level === 'ok' ? 'lime' : 'orange')}>{verdict.text}</span>}</p>}
      </section>
      <section>
        <button className={'btn' + (d.task.done_at ? ' ghost' : ' light')} style={{ width: '100%' }} onClick={toggleDone}>
          <Check size={18} /> {d.task.done_at ? 'Concluída · desfazer' : 'Concluir tarefa'}
        </button>
      </section>
    </>
  );

  return (
    <Shell title={d.subject?.name ?? KIND_LABEL[d.task.kind] ?? 'Estudo'} subtitle={focus ? undefined : d.pacing === 'ciclo' ? KIND_LABEL[d.task.kind] : `${fmtDate(d.task.date)} · ${KIND_LABEL[d.task.kind] ?? ''}`} rail={focus ? undefined : rail} focus={focus}
      actions={focus ? (
        <div className="focus-bar">
          {tabBar}
          <div className="focus-spacer" />
          <span className="focus-clock" style={{ color: timer.running ? 'var(--cyan)' : 'var(--text)' }}>{fmtClock(timer.seconds)}</span>
          {pomoLabel}
          {d.task.goal_questions > 0 && <span className="muted small">{mine.length}/{d.task.goal_questions} questões</span>}
          <button className="btn ghost sm" onClick={timer.toggle}>{timer.running ? <><Pause size={15} /> Pausar</> : <><Play size={15} /> Continuar</>}</button>
          {timer.seconds > 0 && <button className="btn ghost sm" title="Zerar cronômetro" aria-label="Zerar cronômetro" onClick={resetTimer}><RotateCcw size={15} /></button>}
          <button className="btn ghost sm" onClick={toggleDone}><Check size={15} /> {d.task.done_at ? 'Desfazer conclusão' : 'Concluir'}</button>
          <button className="btn ghost sm" title="Esc" onClick={() => setFocus(false)}><Minimize2 size={15} /> Sair do foco</button>
        </div>
      ) : (
        <div className="focus-bar">
          {canFocus && <button className="btn ghost sm" onClick={start}><Maximize2 size={15} /> Modo foco</button>}
          <button className="btn ghost sm" onClick={() => navigate(-1)}>Voltar</button>
        </div>
      )}>
      {!focus && (
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
      )}

      {d.task.kind === 'simulado' ? <SimuladoStarter planId={d.task.plan_id} taskId={d.task.id} /> : (
        <>
          <TheoryReviewCard taskId={d.task.id} sessionId={d.task.session_id} />
          {!focus && <div ref={floating.ref} className={'tabs-float no-print' + (floating.hidden ? ' hide' : '')} onPointerDown={floating.reveal}>{tabBar}</div>}
          {videosOpened && (
            <div hidden={tab !== 'videos'}>
              <VideosPanel taskId={d.task.id} noticeId={d.noticeId} visible={tab === 'videos'} query={videoQuery({ subject: d.subject?.name ?? '', title: d.session?.title ?? d.task.title, topics: d.topics, keyword: d.session?.keyword }).q} />
            </div>
          )}
          {tab === 'videos' ? null
            : tab === 'questoes' ? <QuestionsPanel source={{ kind: 'task', taskId: d.task.id, planId: d.task.plan_id }} goal={d.task.goal_questions} answered={mine.length} />
            : tab === 'pente' ? <PenteFinoPanel taskId={d.task.id} />
            : tab === 'lei' ? <LawReader refs={lawRefs} own={own} missing={missing} />
            : tab === 'juris' ? <JurisPanel taskId={d.task.id} own={own} />
            : tab === 'apostila' ? <GuidePanel taskId={d.task.id} hasSession={hasSession} initialDepth={params.has('revisao') || d.task.title.startsWith(REVIEW_PREFIX) || d.task.title.startsWith(PRACTICE_PREFIX) ? 'revisao' : d.task.title.startsWith(DEEP_PREFIX) ? 'aprofundamento' : 'completa'} />
            : <SessionMaterials sessionId={d.task.session_id} minutes={d.task.kind === 'theory' ? d.task.minutes : 0} />}
        </>
      )}
    </Shell>
  );
}
