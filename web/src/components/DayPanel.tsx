import { CalendarClock, CheckCircle2, Clock, Flame, Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import { isActive, studyStreak, type DayActivity } from '../../../shared/domain/goals.ts';
import type { TaskRow } from '../lib/plans.ts';

const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`);
const weekdayIndex = (day: string) => (new Date(`${day}T12:00:00`).getDay() + 6) % 7; // segunda = 0

// Resumo do dia no topo da tela Hoje (visível também no celular): sequência, tarefas e tempo de hoje, dias até a prova e
// o botão para a próxima tarefa. `todays`: tarefas marcadas para hoje (vazio no ciclo); `next`: a próxima a estudar.
export function DayPanel({ activity, hours, today, todays, next, examDays, reviewsDue }: {
  activity: DayActivity[]; hours: number[]; today: string; todays: TaskRow[]; next: TaskRow | undefined; examDays: number | null; reviewsDue: number;
}) {
  const mine = activity.find((a) => a.day === today), studied = isActive(mine);
  const streak = studyStreak(activity, hours, today);
  const rest = (hours[weekdayIndex(today)] ?? 0) === 0;
  const planned = todays.filter((t) => t.kind !== 'exam'), doneToday = planned.filter((t) => t.done_at).length;
  const minutes = Math.floor((mine?.seconds ?? 0) / 60), plannedMin = planned.reduce((n, t) => n + t.minutes, 0);
  const allDone = planned.length > 0 && doneToday === planned.length;
  const pct = planned.length ? (doneToday / planned.length) * 100 : plannedMin ? Math.min(100, (minutes / plannedMin) * 100) : studied ? 100 : 0;

  const message = studied ? (allDone ? 'Tudo feito hoje. Dia garantido na sequência.' : 'Dia garantido na sequência.')
    : streak > 0 ? (rest ? `Hoje é folga: sua sequência de ${streak} ${streak === 1 ? 'dia' : 'dias'} não quebra.` : `Uma questão ou um minuto de estudo hoje mantém sua sequência de ${streak} ${streak === 1 ? 'dia' : 'dias'}.`)
    : 'Comece hoje uma nova sequência de estudo.';

  return (
    <div className="day-panel">
      <div className="day-stats">
        <div className="day-stat">
          <strong style={{ color: streak ? 'var(--orange)' : 'var(--faint)' }}><Flame size={22} aria-hidden /> {streak}</strong>
          <span>{streak === 1 ? 'dia seguido' : 'dias seguidos'}</span>
        </div>
        <div className="day-stat">
          <strong style={{ color: 'var(--lime)' }}><CheckCircle2 size={20} aria-hidden /> {planned.length ? `${doneToday}/${planned.length}` : mine?.tasks_done ?? 0}</strong>
          <span>{planned.length ? 'tarefas de hoje' : 'tarefas hoje'}</span>
        </div>
        <div className="day-stat">
          <strong style={{ color: 'var(--cyan)' }}><Clock size={20} aria-hidden /> {fmtMin(minutes)}</strong>
          <span>{plannedMin ? `de ${fmtMin(plannedMin)} hoje` : 'estudados hoje'}</span>
        </div>
        {examDays != null && (
          <div className="day-stat">
            <strong style={{ color: 'var(--violet)' }}><CalendarClock size={20} aria-hidden /> {Math.max(0, examDays)}</strong>
            <span>{examDays === 1 ? 'dia até a prova' : 'dias até a prova'}</span>
          </div>
        )}
      </div>
      <div className="bar" role="progressbar" aria-label="Progresso de hoje" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <span style={{ width: `${pct}%`, background: 'var(--lime)' }} />
      </div>
      <div className="day-next">
        <p className={studied ? 'muted' : ''} style={{ margin: 0, flex: 1, minWidth: 200 }}>{message}</p>
        {next ? <Link className="btn" to={`/estudo/${next.id}`}><Play size={18} /> {studied ? 'Continuar' : 'Começar'}</Link>
          : reviewsDue > 0 ? <Link className="btn" to="/revisoes"><Play size={18} /> Revisar {reviewsDue} {reviewsDue === 1 ? 'tema' : 'temas'}</Link> : null}
      </div>
      {next && <p className="faint small" style={{ margin: 0 }}>Próxima: {next.title}</p>}
    </div>
  );
}
