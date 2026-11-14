import { Play, RotateCcw } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { SubjectRow } from '../lib/plans.ts';
import type { TheoryReview } from '../lib/theoryReviews.ts';

const THEORY_SHOWN = 4;
// Estimativa de tempo, em minutos: revisão curta de um tema, questão errada refeita, flashcard.
const MIN_THEME = 4, MIN_ERROR = 1.5, MIN_CARD = 0.5;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Revisão do dia na tela Hoje: tudo o que vence hoje num cartão só (temas de teoria, erros do caderno e flashcards), com
// tempo estimado e um botão que começa pelo primeiro item. `hasReviews`: o plano já tem temas em revisão.
export function DailyReview({ themes, errors, cards, subjects, today, hasReviews }: {
  themes: TheoryReview[]; errors: number; cards: number; subjects: SubjectRow[]; today: string; hasReviews: boolean;
}) {
  const total = themes.length + errors + cards;
  if (!total && !hasReviews) return null;
  const minutes = Math.max(1, Math.round(themes.length * MIN_THEME + errors * MIN_ERROR + cards * MIN_CARD));
  const first = themes[0] ? `/estudo/${themes[0].task_id}?revisao=1` : errors ? '/questoes?aba=revisar' : '/questoes?aba=flashcards';
  return (
    <div className="glass card daily-review">
      <div className="daily-review-head">
        <RotateCcw size={20} style={{ color: total ? 'var(--orange)' : 'var(--cyan)' }} />
        <div style={{ flex: 1, minWidth: 180 }}>
          <strong>Revisão do dia</strong>
          <div className="muted small">{total ? `${[themes.length && plural(themes.length, 'tema', 'temas'), errors && plural(errors, 'erro', 'erros'), cards && plural(cards, 'flashcard', 'flashcards')].filter(Boolean).join(' · ')} · cerca de ${minutes} min` : 'Nada para revisar hoje.'}</div>
        </div>
        {hasReviews && <Link className="btn ghost sm" to="/revisoes">Ver todas</Link>}
        {!!total && <Link className="btn sm" to={first}><Play size={15} /> Começar</Link>}
      </div>
      {!!total && (
        <div className="grid" style={{ gap: 8 }}>
          {themes.slice(0, THEORY_SHOWN).map((r) => (
            <div key={r.id} className="material-row">
              <div style={{ flex: 1, minWidth: 200 }}>
                <div>{r.task.title}</div>
                <div className="muted small">{subjects.find((s) => s.id === r.task.subject_id)?.name ?? ''} · revisão {r.stage} de 3{r.due_on < today ? ' · atrasada' : ''}</div>
              </div>
              <Link className="btn ghost sm" to={`/estudo/${r.task_id}?revisao=1`}>Revisar</Link>
            </div>
          ))}
          {themes.length > THEORY_SHOWN && <p className="faint small" style={{ margin: 0 }}>Os próximos temas aparecem conforme você revisa, começando pelos mais atrasados.</p>}
          {!!errors && (
            <div className="material-row">
              <div style={{ flex: 1, minWidth: 200 }}><div>Caderno de erros</div><div className="muted small">{plural(errors, 'questão errada para refazer', 'questões erradas para refazer')}</div></div>
              <Link className="btn ghost sm" to="/questoes?aba=revisar">Revisar erros</Link>
            </div>
          )}
          {!!cards && (
            <div className="material-row">
              <div style={{ flex: 1, minWidth: 200 }}><div>Flashcards</div><div className="muted small">{plural(cards, 'cartão para hoje', 'cartões para hoje')}</div></div>
              <Link className="btn ghost sm" to="/questoes?aba=flashcards">Abrir</Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
