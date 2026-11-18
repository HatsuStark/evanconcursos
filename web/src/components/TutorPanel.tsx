// Aba "Aprender" da tela de estudo: aula do tema guiada por perguntas da IA (diagnóstico → construção → aplicação →
// fixação → verificação final), salva a cada resposta. É atividade didática: não conta na meta de questões reais, no
// acerto por banca nem nos simulados.
import { BookOpen, GraduationCap, ListChecks, Play, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ymd } from '../../../shared/domain/dates.ts';
import { applyAnswer, initialState, isStrong, LEVEL_LABEL, markTaught, needsTeaching, progress, reportQuestion, scheduleAfterLesson, STAGE_LABEL, STAGE_ORDER, summarize, syncQueue, type AnswerLog, type ConceptOutcome, type Level, type TutorLesson } from '../../../shared/domain/tutor.ts';
import { createSession, knownConcepts, lastTaskSession, saveLessonConcepts, saveSession, waitLesson, type SavedState, type TutorSessionRow } from '../lib/tutor.ts';
import { fmtDate } from './ui.tsx';
import { TutorQuestionCard } from './TutorQuestion.tsx';
import { useQueryClient } from '@tanstack/react-query';

type Phase = 'carregando' | 'inicio' | 'preparando' | 'aula' | 'resumo';
const sameOutline = (a: TutorLesson, b: TutorLesson) => a.conceitos.length === b.conceitos.length && a.conceitos.every((c, i) => c.id === b.conceitos[i]!.id && c.nome === b.conceitos[i]!.nome);
const MAX_GAP_S = 600; // pausa longa entre respostas não conta como estudo

export function TutorPanel({ taskId, planId, subjectId, subject, banca, title, examDate, onGoQuestions, onGoApostila }: {
  taskId: string; planId: string; subjectId: string | null; subject: string; banca: string; title: string; examDate: string | null;
  onGoQuestions?: () => void; onGoApostila?: () => void;
}) {
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>('carregando');
  const [row, setRow] = useState<TutorSessionRow | null>(null);
  const [saved, setSaved] = useState<SavedState | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const [error, setError] = useState('');
  const sessionId = useRef<string | null>(null);
  const stateRef = useRef<SavedState | null>(null);
  const lastTick = useRef(Date.now());
  const alive = useRef(true);
  // Liga de novo a cada montagem: no StrictMode o React monta, desmonta e monta outra vez, e a flag ficaria desligada.
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const update = (s: SavedState, persist = true) => {
    stateRef.current = s; setSaved(s);
    if (persist && sessionId.current) void saveSession(sessionId.current, s).catch((e) => console.error('tutor save:', e));
  };

  useEffect(() => {
    let off = false;
    lastTaskSession(taskId).then((r) => { if (off) return; setRow(r); setPhase(r?.status === 'concluida' ? 'resumo' : 'inicio'); })
      .catch((e) => { if (!off) { setError((e as Error).message); setPhase('inicio'); } });
    return () => { off = true; };
  }, [taskId]);

  // Busca (ou espera) a aula. `fresh`: começa uma sessão nova com a primeira versão que chegar; senão, só completa a atual.
  async function follow(fresh: boolean) {
    let chain = Promise.resolve();
    const handle = async (lesson: TutorLesson, key: string) => {
      const cur = stateRef.current;
      if (fresh && !cur) {
        const known = await knownConcepts(key, lesson).catch(() => []);
        const s: SavedState = { ...initialState(lesson, known), lesson, lessonKey: key, elapsed: 0 };
        const created = await createSession({ planId, taskId, kind: 'aula', state: s });
        sessionId.current = created.id; setRow(created); lastTick.current = Date.now();
        update(s, false); setShown(null); setPhase('aula');
      } else if (cur && cur.lesson.parcial) {
        // A espera repete a mesma versão parcial a cada consulta: só grava quando muda algo.
        if (lesson.parcial && lesson.questoes.length === cur.lesson.questoes.length) return;
        update(sameOutline(cur.lesson, lesson) ? { ...cur, ...syncQueue(cur, lesson), lesson } : { ...cur, incomplete: true });
      }
    };
    try {
      const r = await waitLesson(taskId, () => !alive.current, (l, k) => { chain = chain.then(() => handle(l, k)); });
      await chain;
      const cur = stateRef.current;
      if (r?.incomplete && cur?.lesson.parcial) update({ ...cur, incomplete: true });
    } catch (e) {
      await chain.catch(() => {});
      const cur = stateRef.current;
      if (cur) { if (cur.lesson.parcial) update({ ...cur, incomplete: true }); }
      else { setError((e as Error).message); setPhase('inicio'); }
    }
  }

  function start() {
    setError(''); stateRef.current = null; setSaved(null); sessionId.current = null; setPhase('preparando');
    void follow(true);
  }
  function resume(r: TutorSessionRow) {
    sessionId.current = r.id; lastTick.current = Date.now();
    update(r.state, false); setShown(null); setPhase('aula');
    if (r.state.lesson.parcial && !r.state.incomplete) void follow(false);
  }

  function answer(log: AnswerLog) {
    const cur = stateRef.current;
    if (!cur) return;
    const gap = Math.min(MAX_GAP_S, (Date.now() - lastTick.current) / 1000);
    lastTick.current = Date.now();
    setShown(log.qid);
    update({ ...applyAnswer(cur, cur.lesson, log), lesson: cur.lesson, lessonKey: cur.lessonKey, incomplete: cur.incomplete, elapsed: cur.elapsed + gap });
  }
  function reported(qid: string) {
    const cur = stateRef.current;
    if (!cur) return;
    setShown(null);
    update({ ...cur, ...reportQuestion(cur, qid) });
  }

  // Fila vazia: termina (ou espera a segunda parte da aula, que ainda está sendo preparada).
  const waitingRest = !!saved && !saved.queue.length && !shown && saved.lesson.parcial && !saved.incomplete;
  const finishing = useRef(false);
  useEffect(() => {
    if (phase !== 'aula' || !saved || saved.queue.length || shown || waitingRest || finishing.current) return;
    finishing.current = true;
    const levels = summarize(saved.lesson, saved).map((o) => ({ id: o.id, level: o.level }));
    void (async () => {
      try {
        if (saved.lessonKey) await saveLessonConcepts({ planId, taskId, subjectId, lessonKey: saved.lessonKey, lesson: saved.lesson, state: saved, levels, context: { subject, banca, title }, examDate });
        if (sessionId.current) await saveSession(sessionId.current, saved, true);
        await qc.invalidateQueries({ queryKey: ['tutor-concepts'] });
        const r = await lastTaskSession(taskId);
        if (alive.current) { setRow(r); setPhase('resumo'); }
      } catch (e) { setError((e as Error).message); } finally { finishing.current = false; }
    })();
  }, [phase, saved, shown, waitingRest]); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === 'carregando') return <div className="glass card"><div className="spinner" /></div>;

  if (phase === 'inicio' || phase === 'preparando') {
    const open = row?.status === 'andamento' ? row : null;
    return (
      <div className="glass card tutor-intro">
        <h2><GraduationCap size={22} style={{ color: 'var(--violet)' }} /> Aprender por questões</h2>
        <p>Um tutor de IA ensina o tema por meio de perguntas: começa pelo que você já sabe, constrói os conceitos passo a passo, aplica em situações de prova e termina com uma verificação sem pistas. Funciona mesmo sem ter lido a apostila ou visto a videoaula.</p>
        <ol className="tutor-steps">
          {STAGE_ORDER.map((e) => <li key={e}>{STAGE_LABEL[e]}</li>)}
        </ol>
        <p className="faint small">Atividade didática: não conta na meta de questões reais nem no seu acerto por banca. O domínio de cada conceito fica registrado e alimenta as revisões espaçadas.</p>
        {error && <p className="error">{error}</p>}
        {phase === 'preparando'
          ? <div className="tutor-wait"><span className="spinner" /> <span>Montando a sequência de perguntas e conferindo os gabaritos… (cerca de 1 minuto na primeira vez)</span></div>
          : <div className="tutor-help">
            {open && <button className="btn" onClick={() => resume(open)}><Play size={16} /> Continuar ({open.state.logs.length} {open.state.logs.length === 1 ? 'resposta' : 'respostas'})</button>}
            <button className={'btn' + (open ? ' ghost' : '')} onClick={start}><Play size={16} /> {open ? 'Recomeçar' : 'Começar'}</button>
          </div>}
      </div>
    );
  }

  if (phase === 'resumo' && row) {
    return <TutorSummary lesson={row.state.lesson} state={row.state} finishedAt={row.finished_at} examDate={examDate} onRestart={start} onGoQuestions={onGoQuestions} onGoApostila={onGoApostila} />;
  }

  if (!saved) return null;
  const qid = shown ?? saved.queue[0];
  const q = saved.lesson.questoes.find((x) => x.id === qid);
  const p = progress(saved);
  // Contador da etapa atual (o reforço conta como construção): mostra que o diagnóstico tem só 3 perguntas, não a aula toda.
  const group = (id: string) => { const e = saved.lesson.questoes.find((x) => x.id === id)?.etapa; return e === 'reforco' ? 'construcao' : e; };
  const cur = q ? group(q.id) : undefined;
  const inStage = { done: saved.logs.filter((l) => group(l.qid) === cur).length, total: saved.logs.filter((l) => group(l.qid) === cur).length + saved.queue.filter((id) => group(id) === cur).length };
  const stage = q ? STAGE_ORDER.indexOf(q.etapa === 'reforco' ? 'construcao' : q.etapa) : STAGE_ORDER.length;
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="glass card tutor-head">
        <div className="tutor-stages" aria-label="Etapas">
          {STAGE_ORDER.map((e, i) => <span key={e} className={'tutor-stage' + (i < stage ? ' done' : i === stage ? ' on' : '')}>{STAGE_LABEL[e]}</span>)}
        </div>
        <div className="bar"><span style={{ width: `${p.pct}%`, background: 'var(--violet)' }} /></div>
        <div className="tutor-count">
          {q && <strong>{STAGE_LABEL[q.etapa]}: pergunta {inStage.done + (shown ? 0 : 1)} de {inStage.total}</strong>}
          <span className="faint small">Aula: {p.done} de {p.total}{saved.lesson.parcial && !saved.incomplete ? '+' : ''} perguntas · estudo didático, fora da meta de questões</span>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {q ? (
        <TutorQuestionCard key={q.id} q={q} pool={saved.lesson.questoes} concept={saved.lesson.conceitos.find((c) => c.id === q.conceito)} subject={subject} lessonKey={saved.lessonKey} taskId={taskId}
          teach={needsTeaching(saved, q)} onTaught={() => { const cur = stateRef.current; if (cur) update({ ...cur, ...markTaught(cur, q.conceito) }); }}
          onAnswer={answer} onNext={() => setShown(null)} onReported={() => reported(q.id)} />
      ) : waitingRest ? (
        <div className="glass card tutor-wait"><span className="spinner" /> <span>Preparando as perguntas de aplicação, fixação e verificação final…</span></div>
      ) : <div className="glass card"><div className="spinner" /></div>}
    </div>
  );
}

const LEVEL_ORDER: Level[] = ['atencao', 'em_progresso', 'dominado'];
const LEVEL_COLOR: Record<Level, string> = { dominado: 'lime', em_progresso: 'cyan', atencao: 'orange' };

function TutorSummary({ lesson, state, finishedAt, examDate, onRestart, onGoQuestions, onGoApostila }: {
  lesson: TutorLesson; state: SavedState; finishedAt: string | null; examDate: string | null; onRestart: () => void; onGoQuestions?: () => void; onGoApostila?: () => void;
}) {
  const outcomes = summarize(lesson, state);
  const known = lesson.conceitos.filter((c) => state.known.includes(c.id) && !outcomes.some((o) => o.id === c.id));
  const strong = state.logs.filter(isStrong).length;
  const day = finishedAt ? ymd(new Date(finishedAt)) : ymd(new Date());
  const firstReview = outcomes.map((o) => scheduleAfterLesson(null, o.level, day, examDate).due_on).filter(Boolean).sort()[0];
  const attention = outcomes.filter((o) => o.level === 'atencao');
  const group = (lv: Level) => outcomes.filter((o) => o.level === lv);
  return (
    <div className="glass card tutor-summary">
      <h2><GraduationCap size={22} style={{ color: 'var(--violet)' }} /> Aula concluída</h2>
      <div className="stats">
        <div className="stat"><strong style={{ color: 'var(--violet)' }}>{outcomes.length + known.length}</strong><span>conceitos</span></div>
        <div className="stat"><strong style={{ color: 'var(--lime)' }}>{group('dominado').length + known.length}</strong><span>dominados</span></div>
        <div className="stat"><strong style={{ color: 'var(--cyan)' }}>{strong}/{state.logs.length}</strong><span>de primeira, sem ajuda</span></div>
      </div>
      {LEVEL_ORDER.map((lv) => group(lv).length ? (
        <section key={lv}>
          <h3><span className={'badge ' + LEVEL_COLOR[lv]}>{LEVEL_LABEL[lv]}</span></h3>
          <ul className="advice">{group(lv).map((o: ConceptOutcome) => <li key={o.id}>{o.nome}</li>)}</ul>
        </section>
      ) : null)}
      {!!known.length && <section><h3><span className="badge lime">Já sabia</span></h3><ul className="advice">{known.map((c) => <li key={c.id}>{c.nome}</li>)}</ul></section>}
      <p className="muted" style={{ margin: 0 }}>
        {firstReview ? <>Revisões espaçadas agendadas: a primeira em <b>{fmtDate(firstReview)}</b>, com perguntas novas. {attention.length ? 'Os conceitos que pedem atenção voltam antes e com mais frequência.' : ''}</> : 'Sem revisões agendadas: a prova está muito perto.'}
      </p>
      <p className="faint small" style={{ margin: 0 }}>Esta aula não conta na meta de questões da tarefa. Para treinar para a prova, resolva questões reais da banca.</p>
      <div className="tutor-help">
        {onGoQuestions && <button className="btn" onClick={onGoQuestions}><ListChecks size={16} /> Resolver questões reais</button>}
        {onGoApostila && attention.length > 0 && <button className="btn ghost" onClick={onGoApostila}><BookOpen size={16} /> Reforçar na apostila</button>}
        <Link className="btn ghost" to="/revisoes">Ver revisões</Link>
        <button className="btn ghost" onClick={onRestart}><RotateCcw size={16} /> Refazer a aula</button>
      </div>
    </div>
  );
}
