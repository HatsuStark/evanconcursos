// Revisão espaçada do Aprender por Questões: uma pergunta nova para cada conceito que vence hoje (até 8, os mais
// urgentes primeiro). Cada resposta reagenda o conceito. Atividade didática: fora das metas de questões reais.
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, GraduationCap, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { applyAnswer, dueConcepts, isStrong, LEVEL_LABEL, progress, reportQuestion, type AnswerLog, type TutorLesson } from '../../../shared/domain/tutor.ts';
import { Shell } from '../components/Shell.tsx';
import { TutorQuestionCard } from '../components/TutorQuestion.tsx';
import { today, useActivePlan } from '../lib/plans.ts';
import { createSession, fetchReview, openReviewSession, saveReviewConcepts, saveSession, useTutorConcepts, type SavedState } from '../lib/tutor.ts';

const MAX_GAP_S = 600;

export function TutorReviewPage() {
  const qc = useQueryClient();
  const active = useActivePlan();
  const planId = active.data?.plan.id;
  const concepts = useTutorConcepts(planId);
  const [saved, setSaved] = useState<SavedState | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const sessionId = useRef<string | null>(null);
  const lastTick = useRef(Date.now());
  const [checked, setChecked] = useState(false);

  // Revisão de hoje começada e não terminada: continua dela.
  useEffect(() => {
    if (!planId) return;
    void openReviewSession(planId).then((r) => { if (r) { sessionId.current = r.id; setSaved(r.state); } }).catch(() => {}).finally(() => setChecked(true));
  }, [planId]);

  const update = (s: SavedState) => {
    setSaved(s);
    if (sessionId.current) void saveSession(sessionId.current, s).catch((e) => console.error('tutor save:', e));
  };

  async function start() {
    if (!planId) return;
    setBusy(true); setError('');
    try {
      const r = await fetchReview(planId);
      if (!r.questions.length) { setError('Nenhuma pergunta de revisão pôde ser preparada agora. Tente de novo em instantes.'); return; }
      const lesson: TutorLesson = { titulo: 'Revisão espaçada', conceitos: r.concepts, questoes: r.questions };
      const s: SavedState = { v: 1, queue: r.questions.map((q) => q.id), logs: [], skipped: [], reported: [], known: [], lesson, lessonKey: null, elapsed: 0 };
      const row = await createSession({ planId, taskId: null, kind: 'revisao', state: s });
      sessionId.current = row.id; lastTick.current = Date.now();
      setSaved(s); setShown(null);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  function answer(log: AnswerLog) {
    if (!saved) return;
    const gap = Math.min(MAX_GAP_S, (Date.now() - lastTick.current) / 1000);
    lastTick.current = Date.now();
    setShown(log.qid);
    update({ ...saved, ...applyAnswer(saved, saved.lesson, log), elapsed: saved.elapsed + gap });
  }

  // Fim: reagenda os conceitos respondidos e fecha a sessão.
  const finishing = useRef(false);
  useEffect(() => {
    if (!saved || saved.queue.length || shown || done || finishing.current || !concepts.data) return;
    finishing.current = true;
    void (async () => {
      try {
        const keys = new Set(saved.lesson.conceitos.map((c) => c.id));
        await saveReviewConcepts(concepts.data.filter((c) => keys.has(c.concept_key)), saved.lesson, saved.logs, active.data?.notice.exam_date ?? null);
        if (sessionId.current) await saveSession(sessionId.current, saved, true);
        await qc.invalidateQueries({ queryKey: ['tutor-concepts'] });
        setDone(true);
      } catch (e) { setError((e as Error).message); } finally { finishing.current = false; }
    })();
  }, [saved, shown, done, concepts.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = 'Revisão de conceitos', subtitle = 'Aprender por questões · perguntas novas sobre o que você estudou';
  if (active.isLoading || concepts.isLoading || !checked && !!planId) return <Shell title={title} subtitle={subtitle}><div className="spinner" /></Shell>;
  if (!active.data) return <Shell title={title} subtitle={subtitle}><div className="glass card muted">Monte um cronograma para usar as revisões. <Link to="/concursos">Ir para Concursos</Link></div></Shell>;

  const due = dueConcepts(concepts.data ?? [], today());

  if (done && saved) {
    const strong = saved.logs.filter(isStrong).length;
    return (
      <Shell title={title} subtitle={subtitle}>
        <div className="glass card tutor-summary">
          <h2><CheckCircle2 size={22} style={{ color: 'var(--lime)' }} /> Revisão concluída</h2>
          <div className="stats">
            <div className="stat"><strong style={{ color: 'var(--violet)' }}>{saved.logs.length}</strong><span>conceitos revisados</span></div>
            <div className="stat"><strong style={{ color: 'var(--lime)' }}>{strong}</strong><span>lembrados sem ajuda</span></div>
          </div>
          <p className="muted" style={{ margin: 0 }}>Quem você lembrou volta mais tarde; o que escapou volta amanhã, com outra pergunta.</p>
          <div className="tutor-help">
            {due.length > 0 && <button className="btn" onClick={() => { setDone(false); setSaved(null); void start(); }}><Play size={16} /> Revisar mais {due.length}</button>}
            <Link className="btn ghost" to="/revisoes">Voltar às revisões</Link>
          </div>
        </div>
      </Shell>
    );
  }

  if (!saved) {
    return (
      <Shell title={title} subtitle={subtitle}>
        <div className="glass card tutor-intro">
          <h2><GraduationCap size={22} style={{ color: 'var(--violet)' }} /> {due.length ? `${due.length} ${due.length === 1 ? 'conceito para revisar' : 'conceitos para revisar'}` : 'Nada para revisar hoje'}</h2>
          {due.length > 0 && <ul className="advice">{due.map((c) => <li key={c.concept_key}>{c.name} <span className="faint small">· {c.context.subject ?? ''} · {LEVEL_LABEL[c.level].toLowerCase()}</span></li>)}</ul>}
          <p className="faint small">Uma pergunta nova por conceito, sem pistas (cerca de {Math.max(1, due.length)} min). Não conta na meta de questões reais.</p>
          {error && <p className="error">{error}</p>}
          {due.length > 0 && (busy
            ? <div className="tutor-wait"><span className="spinner" /> <span>Preparando perguntas novas e conferindo os gabaritos…</span></div>
            : <button className="btn" onClick={start}><Play size={16} /> Começar</button>)}
          {!due.length && <Link className="btn ghost" to="/revisoes">Voltar às revisões</Link>}
        </div>
      </Shell>
    );
  }

  const qid = shown ?? saved.queue[0];
  const q = saved.lesson.questoes.find((x) => x.id === qid);
  const p = progress(saved);
  return (
    <Shell title={title} subtitle={subtitle}>
      <div className="grid" style={{ gap: 14 }}>
        <div className="glass card tutor-head">
          <div className="bar"><span style={{ width: `${p.pct}%`, background: 'var(--violet)' }} /></div>
          <div className="faint small">{p.done} de {p.total} conceitos · estudo didático, fora da meta de questões</div>
        </div>
        {error && <p className="error">{error}</p>}
        {q ? <TutorQuestionCard key={q.id} q={q} pool={saved.lesson.questoes} concept={saved.lesson.conceitos.find((c) => c.id === q.conceito)} subject={concepts.data?.find((c) => c.concept_key === q.conceito)?.context.subject ?? ''}
          lessonKey={null} taskId={null} onAnswer={answer} onNext={() => setShown(null)} onReported={() => { setShown(null); update({ ...saved, ...reportQuestion(saved, q.id) }); }} />
          : <div className="glass card"><div className="spinner" /></div>}
      </div>
    </Shell>
  );
}
