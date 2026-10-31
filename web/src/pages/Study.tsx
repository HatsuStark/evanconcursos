import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, Check, FileText, ListChecks, Maximize2, Minimize2, Pause, Play, Scale, Video } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { evaluate } from '../../../shared/domain/adaptive.ts';
import { videoQuery } from '../../../shared/domain/videos.ts';
import { GuidePanel } from '../components/GuidePanel.tsx';
import { LawReader } from '../components/LawReader.tsx';
import { QuestionsPanel } from '../components/QuestionsPanel.tsx';
import { SessionMaterials } from '../components/SessionMaterials.tsx';
import { SimuladoStarter } from '../components/SimuladoStarter.tsx';
import { Shell } from '../components/Shell.tsx';
import { TheoryReviewCard } from '../components/TheoryReviewCard.tsx';
import { VideosPanel } from '../components/VideosPanel.tsx';
import { fmtDate, subjectColor, SubjectIcon } from '../components/ui.tsx';
import { sessionLawRefs } from '../lib/legal.ts';
import { KIND_LABEL, setTaskDone } from '../lib/plans.ts';
import { accuracy, saveTimeSpent, useStudy, type StudyData } from '../lib/study.ts';

const fmtClock = (s: number) => `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ':' : ''}${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
// Ordem de estudo: teoria primeiro, questões por último. Lei seca só em assuntos de legislação.
const TABS = [
  { key: 'apostila', label: 'Apostila', icon: BookOpen },
  { key: 'videos', label: 'Vídeos', icon: Video },
  { key: 'lei', label: 'Lei seca', icon: Scale },
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
  return { running, seconds, toggle: () => { if (running) flush(); setRunning(!running); } };
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
  const lawRefs = sessionLawRefs(d.task.title, d.topics, d.subject?.name ?? '');
  const hasSession = !!d.task.session_id;
  const tabs = TABS.filter((t) => (t.key === 'lei' ? lawRefs.length > 0 : t.key === 'apostila' || t.key === 'videos' || t.key === 'material' ? hasSession : true));
  const [tab, setTab] = useState<TabKey>(tabs[0]!.key);
  const [videosOpened, setVideosOpened] = useState(false);
  const color = d.subjectIndex >= 0 ? subjectColor(d.subjectIndex) : 'var(--magenta)';
  const mine = d.attempts.filter((a) => a.task_id === d.task.id);
  const right = mine.filter((a) => a.correct).length;
  const subjectAcc = accuracy(d.attempts), verdict = evaluate(mine.length ? right / mine.length : null);

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
          <div className="bar"><span style={{ width: `${Math.min(100, (timer.seconds / Math.max(60, d.task.minutes * 60)) * 100)}%`, background: 'var(--cyan)', boxShadow: '0 0 10px var(--cyan)' }} /></div>
          <button className={'btn' + (timer.running ? ' ghost' : '')} onClick={timer.running ? timer.toggle : start}>{timer.running ? <><Pause size={18} /> Pausar</> : <><Play size={18} /> {timer.seconds ? 'Continuar' : 'Começar'}</>}</button>
        </div>
      </section>
      <section>
        <h3>Questões</h3>
        <div className="stats">
          <div className="stat"><strong style={{ color: 'var(--violet)' }}>{mine.length}</strong><span>de {d.task.goal_questions || '—'}</span></div>
          <div className="stat"><strong style={{ color: 'var(--lime)' }}>{mine.length ? Math.round((right / mine.length) * 100) + '%' : '—'}</strong><span>acerto hoje</span></div>
          <div className="stat"><strong style={{ color: 'var(--orange)' }}>{subjectAcc != null ? Math.round(subjectAcc * 100) + '%' : '—'}</strong><span>na matéria</span></div>
        </div>
        {d.task.goal_questions > 0 && <div className="bar" style={{ marginTop: 12 }}><span style={{ width: `${Math.min(100, (mine.length / d.task.goal_questions) * 100)}%`, background: 'var(--violet)', boxShadow: '0 0 10px var(--violet)' }} /></div>}
        {!!mine.length && <p className="small" style={{ margin: '10px 0 0' }}><span className={'badge ' + (verdict.level === 'ok' ? 'lime' : 'orange')}>{verdict.text}</span></p>}
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
          {d.task.goal_questions > 0 && <span className="muted small">{mine.length}/{d.task.goal_questions} questões</span>}
          <button className="btn ghost sm" onClick={timer.toggle}>{timer.running ? <><Pause size={15} /> Pausar</> : <><Play size={15} /> Continuar</>}</button>
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
          <TheoryReviewCard taskId={d.task.id} />
          {!focus && tabBar}
          {videosOpened && (
            <div hidden={tab !== 'videos'}>
              <VideosPanel taskId={d.task.id} noticeId={d.noticeId} visible={tab === 'videos'} query={videoQuery({ subject: d.subject?.name ?? '', title: d.session?.title ?? d.task.title, topics: d.topics }).q} />
            </div>
          )}
          {tab === 'videos' ? null
            : tab === 'questoes' ? <QuestionsPanel source={{ kind: 'task', taskId: d.task.id, planId: d.task.plan_id }} goal={d.task.goal_questions} answered={mine.length} />
            : tab === 'lei' ? <LawReader refs={lawRefs} />
            : tab === 'apostila' ? <GuidePanel taskId={d.task.id} hasSession={hasSession} initialDepth={params.has('revisao') ? 'revisao' : 'completa'} />
            : <SessionMaterials sessionId={d.task.session_id} />}
        </>
      )}
    </Shell>
  );
}
