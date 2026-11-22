import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronRight, Layers, Play, RotateCcw, SkipForward } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { allReviewCards, type ReviewSheet } from '../../../shared/domain/review-cards.ts';
import { buildWeeklyQueue } from '../../../shared/domain/weekly-review.ts';
import { wholeThemeTitle } from '../../../shared/domain/parts.ts';
import { ymd } from '../../../shared/domain/dates.ts';
import { useDueCounts } from '../lib/practice.ts';
import { toggleTaskDone, type SubjectRow } from '../lib/plans.ts';
import { nextQuestions, type Question } from '../lib/questions.ts';
import { supabase } from '../lib/supabase.ts';
import type { TheoryReview } from '../lib/theoryReviews.ts';
import { useTutorConcepts } from '../lib/tutor.ts';
import { fetchGuide, type GuideRow } from './GuidePanel.tsx';
import { QuestionsPanel } from './QuestionsPanel.tsx';
import { ReviewCards } from './ReviewCards.tsx';
import { TheoryReviewCard } from './TheoryReviewCard.tsx';

const ERROR_BATCH = 10, MAX_BATCHES = 8; // até 80 erros vencidos por sessão
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

interface WeeklyTask { id: string; plan_id: string; minutes: number; done_at: string | null }

// Foto da sessão no momento em que abre: temas vencidos, erros vencidos (do cache, sem créditos) e a sessão de estudo em
// que cada erro aconteceu, para ligá-lo ao tema. Refeita a cada abertura: o que já foi revisado não volta.
async function loadSession(task: WeeklyTask) {
  const today = ymd(new Date());
  const { data: rows, error } = await supabase.from('theory_reviews')
    .select('id, task_id, session_id, stage, due_on, status, reviews, last_result, last_reviewed_at, task:tasks(title, subject_id)')
    .eq('plan_id', task.plan_id).eq('status', 'pending').lte('due_on', today).order('due_on').limit(500);
  if (error) throw new Error(error.message);
  const questions: Question[] = [];
  for (let i = 0; i < MAX_BATCHES; i++) {
    const r = await nextQuestions(task.id, ERROR_BATCH, questions.map((q) => q.qid));
    questions.push(...r.questions);
    if (r.questions.length < ERROR_BATCH) break;
  }
  const sessionOf = new Map<string, string>();
  if (questions.length) {
    const { data: att } = await supabase.from('question_attempts').select('qid, session_id').eq('plan_id', task.plan_id).eq('correct', false)
      .not('session_id', 'is', null).in('qid', questions.map((q) => q.qid)).order('created_at', { ascending: false }).limit(2000);
    for (const a of (att ?? []) as { qid: string; session_id: string }[]) if (!sessionOf.has(a.qid)) sessionOf.set(a.qid, a.session_id);
  }
  const themes = (rows ?? []) as unknown as TheoryReview[];
  const queue = buildWeeklyQueue(themes, questions.map((q) => ({ qid: q.qid, session_id: sessionOf.get(q.qid) ?? null })), task.minutes, today);
  return { queue, byQid: new Map(questions.map((q) => [q.qid, q])) };
}

type Phase = { at: 'intro' } | { at: 'theme'; i: number; part: 'cards' | 'errors' } | { at: 'closing' };

// Revisão da semana guiada: um tema por vez (cartões da revisão curta, depois os erros dele), e no fim os erros soltos,
// os conceitos da Aula guiada e os mnemônicos. Tudo por toque: nada para digitar.
export function WeeklySession({ task, subjects }: { task: WeeklyTask; subjects: SubjectRow[] }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const session = useQuery({ queryKey: ['weekly-session', task.id], queryFn: () => loadSession(task), staleTime: Infinity, refetchOnMount: 'always', refetchOnWindowFocus: false });
  const concepts = (useTutorConcepts(task.plan_id).data ?? []).filter((c) => c.due_on && c.due_on <= ymd(new Date())).length;
  const cards = useDueCounts(task.plan_id).data?.cards ?? 0;
  const [phase, setPhase] = useState<Phase>({ at: 'intro' });
  const [busy, setBusy] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => { if (phase.at !== 'intro') top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [phase]);

  if (session.isError) return <div className="glass card"><p className="error" style={{ margin: 0 }}>{(session.error as Error).message}</p></div>;
  if (!session.data) return <div className="glass card"><div className="spinner" /> <span className="muted small">Montando a revisão da semana…</span></div>;
  const { queue, byQid } = session.data;
  const { steps, loose } = queue;
  const n = steps.length;
  const subjectName = (id: string | null) => subjects.find((s) => s.id === id)?.name ?? '';
  const pick = (qids: string[]) => qids.map((q) => byQid.get(q)).filter((q): q is Question => !!q);
  const after = (i: number): Phase => (i + 1 < n ? { at: 'theme', i: i + 1, part: 'cards' } : { at: 'closing' });

  async function finish() {
    setBusy(true);
    try { await toggleTaskDone(qc, task.id, true); navigate('/'); } finally { setBusy(false); }
  }

  if (phase.at === 'intro') {
    const empty = !n && !loose.length && !concepts && !cards;
    return (
      <div ref={top} className="glass card grid" style={{ gap: 14 }}>
        <div className="daily-review-head">
          <RotateCcw size={22} style={{ color: 'var(--lime)' }} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <strong>Revisão da semana</strong>
            <div className="muted small">{empty ? 'Nada vencido para revisar nesta semana.' : `${[n && plural(n, 'tema', 'temas'), (loose.length + steps.reduce((a, s) => a + s.errors.length, 0)) && plural(loose.length + steps.reduce((a, s) => a + s.errors.length, 0), 'erro', 'erros')].filter(Boolean).join(' · ')} · cerca de ${queue.minutes} min`}</div>
          </div>
          {!empty && <button className="btn" onClick={() => setPhase(n ? { at: 'theme', i: 0, part: 'cards' } : { at: 'closing' })}><Play size={16} /> Começar</button>}
          {empty && !task.done_at && <button className="btn" disabled={busy} onClick={finish}><CheckCircle2 size={16} /> Concluir</button>}
        </div>
        {!!n && (
          <ol className="weekly-list">
            {steps.map((s) => (
              <li key={s.theme.id}>
                <span>{wholeThemeTitle(s.theme.task.title)}</span>
                <span className="faint small">{[subjectName(s.theme.task.subject_id), `revisão ${s.theme.stage} de 3`, s.errors.length && plural(s.errors.length, 'erro', 'erros')].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="muted small" style={{ margin: 0 }}>
          Para cada tema: cartões da revisão curta e, em seguida, as questões que você errou nele. No fim, os outros erros{concepts ? ', os conceitos da Aula guiada' : ''}{cards ? ' e os mnemônicos' : ''}.
          {queue.deferredThemes + queue.deferredErrors > 0 && ` Para caber no tempo do bloco, ${[queue.deferredThemes && plural(queue.deferredThemes, 'tema', 'temas'), queue.deferredErrors && plural(queue.deferredErrors, 'erro', 'erros')].filter(Boolean).join(' e ')} ficam para a próxima semana.`}
        </p>
      </div>
    );
  }

  if (phase.at === 'theme') {
    const step = steps[phase.i]!, errs = pick(step.errors);
    const nextLabel = errs.length ? `Erros deste tema (${errs.length})` : phase.i + 1 < n ? 'Próximo tema' : 'Fechamento';
    const goNext = () => setPhase(errs.length ? { at: 'theme', i: phase.i, part: 'errors' } : after(phase.i));
    return (
      <div ref={top} className="grid" style={{ gap: 12 }}>
        <div className="glass card weekly-head">
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="faint small">Tema {phase.i + 1} de {n}{phase.part === 'errors' ? ' · erros do tema' : ''}</div>
            <strong>{wholeThemeTitle(step.theme.task.title)}</strong>
            <div className="muted small">{subjectName(step.theme.task.subject_id)} · revisão {step.theme.stage} de 3</div>
          </div>
          <button className="btn ghost sm" onClick={() => setPhase(after(phase.i))}><SkipForward size={15} /> Pular tema</button>
          <div className="bar" style={{ flexBasis: '100%' }}><span style={{ width: `${((phase.i + (phase.part === 'errors' ? 0.6 : 0.1)) / n) * 100}%`, background: 'var(--lime)' }} /></div>
        </div>
        {phase.part === 'cards'
          ? <ThemeCards key={step.theme.id} review={step.theme} next={{ label: nextLabel, onClick: goNext }} />
          : (
            <>
              <QuestionsPanel key={`e-${step.theme.id}`} source={{ kind: 'list', taskId: task.id, planId: task.plan_id, questions: errs }} />
              <button className="btn" style={{ justifySelf: 'start' }} onClick={() => setPhase(after(phase.i))}>{phase.i + 1 < n ? 'Próximo tema' : 'Fechamento'} <ChevronRight size={16} /></button>
            </>
          )}
      </div>
    );
  }

  const looseQs = pick(loose);
  return (
    <div ref={top} className="grid" style={{ gap: 12 }}>
      <div className="glass card weekly-head">
        <div style={{ flex: 1 }}>
          <div className="faint small">Fechamento</div>
          <strong>{looseQs.length ? 'Erros de várias matérias' : 'Últimos itens da semana'}</strong>
        </div>
      </div>
      {!!looseQs.length && <QuestionsPanel key="loose" source={{ kind: 'list', taskId: task.id, planId: task.plan_id, questions: looseQs }} />}
      {!!concepts && (
        <div className="glass card material-row">
          <div style={{ flex: 1, minWidth: 200 }}><div>Conceitos da Aula guiada</div><div className="muted small">{plural(concepts, 'conceito para revisar', 'conceitos para revisar')} · perguntas novas</div></div>
          <Link className="btn ghost sm" to="/aprender/revisao">Revisar</Link>
        </div>
      )}
      {!!cards && (
        <div className="glass card material-row">
          <div style={{ flex: 1, minWidth: 200 }}><div>Mnemônicos</div><div className="muted small">{plural(cards, 'flashcard para rever', 'flashcards para rever')}</div></div>
          <Link className="btn ghost sm" to="/questoes?aba=flashcards"><Layers size={15} /> Abrir</Link>
        </div>
      )}
      <div className="glass card daily-review-head">
        <CheckCircle2 size={20} style={{ color: 'var(--lime)' }} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <strong>{task.done_at ? 'Revisão da semana concluída' : 'Fim da revisão da semana'}</strong>
          <div className="muted small">O que ficou de fora volta na próxima semana.</div>
        </div>
        {!task.done_at && <button className="btn" disabled={busy} onClick={finish}>Concluir revisão</button>}
      </div>
    </div>
  );
}

// Cartões da revisão curta do tema (a mesma do modo estudo). Sem cartões ou com falha, o registro simples e a apostila.
function ThemeCards({ review, next }: { review: TheoryReview; next: { label: string; onClick: () => void } }) {
  const [guide, setGuide] = useState<GuideRow | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let off = false;
    fetchGuide(review.task_id, 'revisao', () => off, () => {}).then((r) => { if (!off && r) setGuide(r.guide); }).catch((e) => { if (!off) setError((e as Error).message); });
    return () => { off = true; };
  }, [review.task_id]);
  const sheet = guide?.content as unknown as ReviewSheet | undefined;
  const hasCards = useMemo(() => !!sheet && allReviewCards(sheet).length > 0, [sheet]);
  const openSheet = () => window.open(`/estudo/${review.task_id}?revisao=1`, '_blank', 'noopener');

  if (!guide && !error) return <div className="glass card"><div className="spinner" /> <span className="muted small">Preparando a revisão curta…</span></div>;
  if (hasCards) return <ReviewCards taskId={review.task_id} title={wholeThemeTitle(review.task.title)} sheet={sheet!} onShowSheet={openSheet} next={next} />;
  return (
    <div className="grid" style={{ gap: 12 }}>
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      <TheoryReviewCard taskId={review.task_id} sessionId={review.session_id} />
      <div className="daily-review-head">
        <button className="btn ghost sm" onClick={openSheet}>Abrir a revisão curta</button>
        <button className="btn" onClick={next.onClick}>{next.label} <ChevronRight size={16} /></button>
      </div>
    </div>
  );
}
