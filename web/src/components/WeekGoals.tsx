import { Flame } from 'lucide-react';
import { studyStreak, weekDays, weeklyGoals, type DayActivity, type GoalTask } from '../../../shared/domain/goals.ts';
import { today } from '../lib/plans.ts';

const WEEKDAY_LETTERS = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];
const fmtHours = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;

function GoalBar({ label, done, goal, text, color }: { label: string; done: number; goal: number; text: string; color: string }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{label}</span><span className="muted">{text}</span></div>
      {goal > 0 && <div className="bar" style={{ marginTop: 5 }}><span style={{ width: `${Math.min(100, (done / goal) * 100)}%`, background: color, boxShadow: `0 0 8px ${color}` }} /></div>}
    </div>
  );
}

// Painel da tela Hoje: o previsto no cronograma para a semana contra o feito, e os dias seguidos de estudo.
export function WeekGoals({ tasks, activity, hours }: { tasks: GoalTask[]; activity: DayActivity[]; hours: number[] }) {
  const t0 = today(), g = weeklyGoals(tasks, activity, t0), streak = studyStreak(activity, hours, t0);
  const of = (done: string, goal: number, shown: string) => (goal > 0 ? `${done} de ${shown}` : done);
  return (
    <>
      <section>
        <h3>Metas da semana</h3>
        <div className="glass card" style={{ display: 'grid', gap: 12 }}>
          <GoalBar label="Horas" done={g.minutes.done} goal={g.minutes.goal} text={of(fmtHours(g.minutes.done), g.minutes.goal, fmtHours(g.minutes.goal))} color="var(--cyan)" />
          <GoalBar label="Questões" done={g.questions.done} goal={g.questions.goal} text={of(String(g.questions.done), g.questions.goal, String(g.questions.goal))} color="var(--violet)" />
          <GoalBar label="Tarefas" done={g.tasks.done} goal={g.tasks.goal} text={of(String(g.tasks.done), g.tasks.goal, String(g.tasks.goal))} color="var(--lime)" />
        </div>
      </section>
      <section>
        <h3>Constância</h3>
        <div className="glass card" style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Flame size={24} style={{ color: streak ? 'var(--orange)' : 'var(--faint)' }} />
            <div><strong style={{ fontSize: 24 }}>{streak}</strong> <span className="muted small">{streak === 1 ? 'dia seguido' : 'dias seguidos'}</span></div>
          </div>
          <div className="week-days">
            {weekDays(activity, hours, t0).map((d, i) => (
              <span key={d.day} className={'week-day' + (d.active ? ' active' : '') + (d.isToday ? ' today' : '') + (d.rest && !d.active ? ' rest' : '')}
                title={`${new Date(`${d.day}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long' })}: ${d.active ? 'estudou' : d.future ? 'ainda não chegou' : d.rest ? 'folga' : d.isToday ? 'ainda sem estudo' : 'sem estudo'}`}>
                {WEEKDAY_LETTERS[i]}
              </span>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
