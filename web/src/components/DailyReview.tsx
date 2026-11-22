import { useQueryClient } from '@tanstack/react-query';
import { Check, Play, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { DailyMode } from '../../../shared/domain/theory-reviews.ts';
import { toggleTaskDone, type SubjectRow, type TaskRow } from '../lib/plans.ts';
import type { TheoryReview } from '../lib/theoryReviews.ts';
import { fmtDate } from './ui.tsx';

const THEORY_SHOWN = 4;
// Estimativa de tempo, em minutos: revisão curta de um tema, questão errada refeita, flashcard, conceito da Aula guiada.
const MIN_THEME = 4, MIN_ERROR = 1.5, MIN_CARD = 0.5, MIN_CONCEPT = 1;
// A revisão de conceitos é uma sessão curta: no máximo 8 por vez (REVIEW_SESSION_MAX), para não pesar no dia.
const CONCEPTS_PER_SESSION = 8;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Revisão como atividade do dia, no topo do "Estudo do dia" (regras em dailyReviews):
// - dia comum: "Revisão rápida", até 3 temas; erros, flashcards e conceitos esperam a revisão da semana;
// - dia da revisão semanal (ou depois, enquanto não for feita): tudo o que venceu, com o botão de concluir a tarefa;
// - plano sem revisão semanal pela frente: até 5 temas e o resto como antes.
export function DailyReview({ mode, themes, deferred, weekly, nextWeekly, errors, cards, concepts = 0, subjects, today }: {
  mode: DailyMode; themes: TheoryReview[]; deferred: number; weekly: TaskRow | null; nextWeekly: string | null;
  errors: number; cards: number; concepts?: number; subjects: SubjectRow[]; today: string;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const extras = mode !== 'daily';
  const nErrors = extras ? errors : 0, nCards = extras ? cards : 0, nConcepts = extras ? concepts : 0;
  const total = themes.length + nErrors + nCards + nConcepts;
  if (!total && !weekly) return null;
  const shownConcepts = Math.min(nConcepts, CONCEPTS_PER_SESSION);
  const minutes = Math.max(1, Math.round(themes.length * MIN_THEME + nErrors * MIN_ERROR + nCards * MIN_CARD + shownConcepts * MIN_CONCEPT));
  const errorsTo = weekly ? `/estudo/${weekly.id}` : '/questoes?aba=revisar';
  // Na semana, "Começar" abre a revisão guiada (um tema por vez, com os erros dele).
  const first = weekly ? `/estudo/${weekly.id}` : themes[0] ? `/estudo/${themes[0].task_id}?revisao=1` : nErrors ? errorsTo : nCards ? '/questoes?aba=flashcards' : '/aprender/revisao';
  const title = mode === 'weekly' ? 'Revisão da semana' : mode === 'daily' ? 'Revisão rápida' : 'Revisão do dia';
  const late = weekly && weekly.date < today ? ` · pendente desde ${fmtDate(weekly.date)}` : '';
  const summary = total
    ? `${[themes.length && plural(themes.length, 'tema', 'temas'), nErrors && plural(nErrors, 'erro', 'erros'), nCards && plural(nCards, 'flashcard', 'flashcards'), nConcepts && plural(nConcepts, 'conceito', 'conceitos')].filter(Boolean).join(' · ')} · cerca de ${minutes} min`
    : 'Nada vencido para revisar.';

  async function finishWeekly() {
    if (!weekly) return;
    setBusy(true);
    try { await toggleTaskDone(qc, weekly.id, true); } finally { setBusy(false); }
  }

  return (
    <div className="glass card daily-review" style={{ margin: '0 0 12px', borderLeft: `3px solid ${mode === 'weekly' ? 'var(--lime)' : 'var(--orange)'}` }}>
      <div className="daily-review-head">
        <RotateCcw size={20} style={{ color: mode === 'weekly' ? 'var(--lime)' : 'var(--orange)' }} />
        <div style={{ flex: 1, minWidth: 180 }}>
          <strong>{title}</strong>
          <div className="muted small">{summary}{late}</div>
        </div>
        <Link className="btn ghost sm" to="/revisoes">Ver todas</Link>
        {!!total && <Link className="btn sm" to={first}><Play size={15} /> Começar</Link>}
        {weekly && (
          <button className="check-btn" disabled={busy} onClick={finishWeekly} aria-label="Marcar a revisão da semana como feita" title="Marcar como feita">
            <Check size={18} />
          </button>
        )}
      </div>
      {!!total && (
        <div className="grid" style={{ gap: 8 }}>
          {themes.slice(0, THEORY_SHOWN).map((r) => (
            <div key={r.id} className="material-row">
              <div style={{ flex: 1, minWidth: 200 }}>
                <div>{r.task.title}</div>
                <div className="muted small">{subjects.find((s) => s.id === r.task.subject_id)?.name ?? ''} · revisão {r.stage} de 3</div>
              </div>
              <Link className="btn ghost sm" to={`/estudo/${r.task_id}?revisao=1`}>Revisar</Link>
            </div>
          ))}
          {themes.length > THEORY_SHOWN && <p className="faint small" style={{ margin: 0 }}>Os próximos temas aparecem conforme você revisa, começando pelos mais atrasados.</p>}
          {!!nErrors && (
            <div className="material-row">
              <div style={{ flex: 1, minWidth: 200 }}><div>Caderno de erros</div><div className="muted small">{plural(nErrors, 'questão errada para refazer', 'questões erradas para refazer')}</div></div>
              <Link className="btn ghost sm" to={errorsTo}>Revisar erros</Link>
            </div>
          )}
          {!!nCards && (
            <div className="material-row">
              <div style={{ flex: 1, minWidth: 200 }}><div>Flashcards</div><div className="muted small">{plural(nCards, 'mnemônico para rever', 'mnemônicos para rever')}</div></div>
              <Link className="btn ghost sm" to="/questoes?aba=flashcards">Abrir</Link>
            </div>
          )}
          {!!nConcepts && (
            <div className="material-row">
              <div style={{ flex: 1, minWidth: 200 }}><div>Conceitos da Aula guiada</div><div className="muted small">{plural(nConcepts, 'conceito para revisar', 'conceitos para revisar')}{nConcepts > CONCEPTS_PER_SESSION ? ` · ${CONCEPTS_PER_SESSION} por sessão` : ''} · perguntas novas</div></div>
              <Link className="btn ghost sm" to="/aprender/revisao">Revisar</Link>
            </div>
          )}
        </div>
      )}
      {mode === 'daily' && (deferred > 0 || errors + cards + concepts > 0) && (
        <p className="faint small" style={{ margin: '8px 0 0' }}>
          {[deferred && plural(deferred, 'tema', 'temas'), errors && plural(errors, 'erro', 'erros'), (cards + concepts) && 'flashcards e conceitos'].filter(Boolean).join(', ')} ficam para a revisão da semana{nextWeekly ? ` (${fmtDate(nextWeekly)})` : ''}.
        </p>
      )}
    </div>
  );
}
