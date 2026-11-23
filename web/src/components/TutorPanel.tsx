// Aba "Aula guiada" da tela de estudo: aula do tema guiada por perguntas da IA (diagnóstico → construção → aplicação →
// fixação → verificação final), salva a cada resposta. É atividade didática: não conta na meta de questões reais, no
// acerto por banca nem nos simulados.
import { BookOpen, ChevronDown, GraduationCap, ListChecks, Play, RotateCcw, Target } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ymd } from '../../../shared/domain/dates.ts';
import { applyAnswer, bestStreak, conceptStatuses, initialState, isStrong, LEVEL_LABEL, markRecapped, markTaught, needsExample, needsTeaching, offersRoadmap, pendingRecap, progress, reportQuestion, scheduleAfterLesson, STAGE_LABEL, STAGE_ORDER, summarize, syncQueue, visibleStages, type AnswerLog, type ConceptOutcome, type TutorLesson } from '../../../shared/domain/tutor.ts';
import { missingMark } from '../../../shared/ai/marks.ts';
import { createSession, fetchPractice, knownConcepts, lastTaskSession, saveLessonConcepts, saveSession, waitLesson, type SavedState, type TutorSessionRow } from '../lib/tutor.ts';
import { fmtDate } from './ui.tsx';
import { TutorQuestionCard, WorkedExampleCard } from './TutorQuestion.tsx';
import { ConceptMap, PocketCard, StageRecap } from './TutorVisuals.tsx';
import { QuestionsPanel } from './QuestionsPanel.tsx';
import type { Question } from '../lib/questions.ts';
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
        <h2><GraduationCap size={22} style={{ color: 'var(--violet)' }} /> Aula guiada</h2>
        <p>Um tutor de IA ensina o tema por meio de perguntas: começa pelo que você já sabe, constrói os conceitos passo a passo, aplica em situações de prova e termina com uma verificação sem pistas. Funciona mesmo sem ter lido a apostila ou visto a videoaula.</p>
        <ol className="tutor-steps">
          {STAGE_ORDER.filter((e) => e !== 'desafio').map((e) => <li key={e}>{STAGE_LABEL[e]}</li>)}
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
    return <TutorSummary lesson={row.state.lesson} state={row.state} finishedAt={row.finished_at} examDate={examDate} taskId={taskId} planId={planId} onRestart={start} onGoQuestions={onGoQuestions} onGoApostila={onGoApostila} />;
  }

  if (!saved) return null;
  const qid = shown ?? saved.queue[0];
  const q = saved.lesson.questoes.find((x) => x.id === qid);
  // Cópia antiga da aula com pergunta que fala em termo destacado sem marcá-lo: pula (a conferência nova já a descarta).
  if (q && !shown && missingMark(q.enunciado)) { queueMicrotask(() => reported(q.id)); return <div className="glass card"><div className="spinner" /></div>; }
  const p = progress(saved);
  // Contador da etapa atual (o reforço conta como construção): mostra que o diagnóstico tem só 3 perguntas, não a aula toda.
  const group = (id: string) => { const e = saved.lesson.questoes.find((x) => x.id === id)?.etapa; return e === 'reforco' ? 'construcao' : e; };
  const cur = q ? group(q.id) : undefined;
  const inStage = { done: saved.logs.filter((l) => group(l.qid) === cur).length, total: saved.logs.filter((l) => group(l.qid) === cur).length + saved.queue.filter((id) => group(id) === cur).length };
  // O desafio só aparece no topo quando entrou na aula (quem está indo bem).
  const stages = visibleStages(saved.lesson, saved);
  const stage = q ? stages.indexOf(q.etapa === 'reforco' ? 'construcao' : q.etapa) : stages.length;
  // Ao avançar de etapa, antes da primeira pergunta da nova: o cartão de recapitulação da que terminou.
  const recap = q && !shown ? pendingRecap(saved, q) : null;
  // O conceito em ensino só acende no mapa na construção: nas etapas de lembrar, ele entregaria a resposta.
  const teaching = q && (q.etapa === 'construcao' || q.etapa === 'reforco') ? q.conceito : undefined;
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="glass card tutor-head">
        <div className="tutor-stages" aria-label="Etapas">
          {stages.map((e, i) => <span key={e} className={'tutor-stage' + (i < stage ? ' done' : i === stage ? ' on' : '')}>{STAGE_LABEL[e]}</span>)}
        </div>
        <div className="bar"><span style={{ width: `${p.pct}%`, background: 'var(--violet)' }} /></div>
        <ConceptMap lesson={saved.lesson} state={saved} current={teaching} />
        <div className="tutor-count">
          {q && <strong>{STAGE_LABEL[q.etapa]}: pergunta {inStage.done + (shown ? 0 : 1)} de {inStage.total}</strong>}
          <span className="faint small">Aula: {p.done} de {p.total}{saved.lesson.parcial && !saved.incomplete ? '+' : ''} perguntas · estudo didático, fora da meta de questões</span>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {q && recap ? (
        <StageRecap stage={recap} next={stages[stage] ?? 'final'} lesson={saved.lesson} state={saved}
          onContinue={() => { const cur = stateRef.current; if (cur) update({ ...cur, recapped: markRecapped(cur, recap).recapped }); }} />
      ) : q && !shown && needsExample(saved, saved.lesson, q) ? (
        <WorkedExampleCard example={saved.lesson.exemplo!} concept={saved.lesson.conceitos.find((c) => c.id === saved.lesson.exemplo!.conceito)}
          onDone={() => { const cur = stateRef.current; if (cur) update({ ...cur, exampleSeen: true }); }} />
      ) : q ? (
        <TutorQuestionCard roadmap={offersRoadmap(saved, saved.lesson, q) ? saved.lesson.exemplo!.passos.map((s) => s.pergunta) : undefined} key={q.id} q={q} pool={saved.lesson.questoes} concept={saved.lesson.conceitos.find((c) => c.id === q.conceito)} subject={subject} lessonKey={saved.lessonKey} taskId={taskId}
          teach={needsTeaching(saved, q)} onTaught={() => { const cur = stateRef.current; if (cur) update({ ...cur, ...markTaught(cur, q.conceito) }); }}
          onAnswer={answer} onNext={() => setShown(null)} onReported={() => reported(q.id)} />
      ) : waitingRest ? (
        <div className="glass card tutor-wait"><span className="spinner" /> <span>Preparando as perguntas de aplicação, fixação e verificação final…</span></div>
      ) : <div className="glass card"><div className="spinner" /></div>}
    </div>
  );
}

// Tempo de estudo (só o tempo entre respostas, sem as pausas longas).
function studyTime(s: number) {
  const m = Math.round(s / 60);
  if (m < 1) return '<1 min';
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

function TutorSummary({ lesson, state, finishedAt, examDate, taskId, planId, onRestart, onGoQuestions, onGoApostila }: {
  lesson: TutorLesson; state: SavedState; finishedAt: string | null; examDate: string | null; taskId: string; planId: string; onRestart: () => void; onGoQuestions?: () => void; onGoApostila?: () => void;
}) {
  const outcomes = summarize(lesson, state);
  const strong = state.logs.filter(isStrong).length;
  const day = finishedAt ? ymd(new Date(finishedAt)) : ymd(new Date());
  const firstReview = outcomes.map((o) => scheduleAfterLesson(null, o.level, day, examDate).due_on).filter(Boolean).sort()[0];
  const attention = outcomes.filter((o) => o.level === 'atencao');
  // Contagem igual ao mapa: "já sabia" conta como dominado.
  const statuses = conceptStatuses(lesson, state).filter((c) => c.status !== 'pendente');
  const mastered = statuses.filter((c) => c.status === 'dominado' || c.status === 'conhecido').length;
  const streak = bestStreak(state.logs);
  return (
    <div className="glass card tutor-summary">
      <h2><GraduationCap size={22} style={{ color: 'var(--violet)' }} /> Aula concluída</h2>
      <p className="muted" style={{ margin: 0 }}>{lesson.titulo}</p>
      <ConceptMap lesson={lesson} state={state} legend />
      <div className="stats tutor-stats">
        <div className="stat"><strong style={{ color: 'var(--lime)' }}>{mastered}/{statuses.length}</strong><span>conceitos dominados</span></div>
        <div className="stat"><strong style={{ color: 'var(--cyan)' }}>{strong}/{state.logs.length}</strong><span>de primeira, sem ajuda</span></div>
        <div className="stat"><strong style={{ color: 'var(--violet)' }}>{streak}</strong><span>melhor sequência</span></div>
        <div className="stat"><strong>{studyTime(state.elapsed ?? 0)}</strong><span>de estudo</span></div>
      </div>
      {!!attention.length && <p style={{ margin: 0 }}><span className="badge orange">{LEVEL_LABEL.atencao}</span> {attention.map((o: ConceptOutcome) => o.nome).join(' · ')}</p>}
      <p className="muted" style={{ margin: 0 }}>
        {firstReview ? <>Revisões espaçadas agendadas: a primeira em <b>{fmtDate(firstReview)}</b>, com perguntas novas. {attention.length ? 'Os conceitos que pedem atenção voltam antes e com mais frequência.' : ''}</> : 'Sem revisões agendadas: a prova está muito perto.'}
      </p>
      <p className="faint small" style={{ margin: 0 }}>Esta aula não conta na meta de questões da tarefa. Para treinar para a prova, resolva questões reais da banca.</p>
      <PocketCard lesson={lesson} state={state} />
      <RealPractice lesson={lesson} outcomes={outcomes} taskId={taskId} planId={planId} onGoQuestions={onGoQuestions} />
      <div className="tutor-help">
        {onGoQuestions && <button className="btn ghost" onClick={onGoQuestions}><ListChecks size={16} /> Todas as questões da tarefa</button>}
        {onGoApostila && attention.length > 0 && <button className="btn ghost" onClick={onGoApostila}><BookOpen size={16} /> Reforçar na apostila</button>}
        <Link className="btn ghost" to="/revisoes">Ver revisões</Link>
        <button className="btn ghost" onClick={onRestart}><RotateCcw size={16} /> Refazer a aula</button>
      </div>
    </div>
  );
}

// Ligação com o treino para a prova: para os conceitos que mais precisam (atenção, depois em construção; com tudo
// dominado, os principais), questões reais da banca já no banco do app, escolhidas pela IA por conceito. A busca só
// acontece quando o estudante pede (tem custo). As respostas contam na meta de questões da tarefa.
const PRACTICE_CONCEPTS = 6;
function RealPractice({ lesson, outcomes, taskId, planId, onGoQuestions }: {
  lesson: TutorLesson; outcomes: ConceptOutcome[]; taskId: string; planId: string; onGoQuestions?: () => void;
}) {
  const weak = [...outcomes.filter((o) => o.level === 'atencao'), ...outcomes.filter((o) => o.level === 'em_progresso')];
  const targets = (weak.length ? weak : outcomes).slice(0, PRACTICE_CONCEPTS);
  const [groups, setGroups] = useState<{ conceito: string; questions: Question[] }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  if (!targets.length) return null;
  async function find() {
    setBusy(true); setError('');
    try {
      const g = await fetchPractice(taskId, targets.map((o) => ({ id: o.id, nome: o.nome, essencial: lesson.conceitos.find((c) => c.id === o.id)?.essencial ?? '' })));
      setGroups(g); setOpen(g[0]?.conceito ?? null);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <section className="tutor-real">
      <h3><Target size={18} /> Treinar com questões reais</h3>
      {!groups ? (
        <>
          <p className="muted" style={{ margin: 0 }}>{weak.length ? 'Questões de prova da banca que cobram exatamente os pontos em que você teve dificuldade.' : 'Questões de prova da banca sobre os conceitos da aula.'} Contam na meta de questões da tarefa.</p>
          {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
          <div className="tutor-help">
            {busy ? <div className="tutor-wait"><span className="spinner" /> <span>Escolhendo as questões de cada ponto…</span></div>
              : <button className="btn" onClick={find}><Target size={16} /> Buscar questões {weak.length ? 'dos pontos fracos' : 'desses conceitos'}</button>}
          </div>
        </>
      ) : !groups.length ? (
        <p className="muted" style={{ margin: 0 }}>Ainda não há questões reais guardadas que cobrem esses pontos. {onGoQuestions ? 'Resolva as questões da tarefa: elas também treinam o tema.' : ''}</p>
      ) : (
        <div className="grid" style={{ gap: 10 }}>
          {targets.map((o) => {
            const g = groups.find((x) => x.conceito === o.id);
            return (
              <div key={o.id} className="tutor-real-row">
                <div className="material-row">
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div>{o.nome}</div>
                    <div className="muted small">{LEVEL_LABEL[o.level]} · {g ? `${g.questions.length} ${g.questions.length === 1 ? 'questão' : 'questões'} da banca` : 'nenhuma questão guardada cobre este ponto'}</div>
                  </div>
                  {g && <button className={'btn sm' + (open === o.id ? ' ghost' : '')} onClick={() => setOpen(open === o.id ? null : o.id)}>{open === o.id ? <><ChevronDown size={15} /> Fechar</> : 'Resolver'}</button>}
                </div>
                {g && open === o.id && <QuestionsPanel source={{ kind: 'list', taskId, planId, questions: g.questions }} />}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
