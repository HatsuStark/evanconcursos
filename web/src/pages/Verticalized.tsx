import { Check, Circle, CircleDashed, CircleOff } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { GOOD, WEAK } from '../../../shared/domain/adaptive.ts';
import type { TopicRow, TopicStatus } from '../../../shared/domain/verticalized.ts';
import { Shell } from '../components/Shell.tsx';
import { fmtDate, subjectColor, SubjectIcon } from '../components/ui.tsx';
import { useActivePlan } from '../lib/plans.ts';
import { useVerticalized } from '../lib/verticalized.ts';

const FILTERS = [
  { key: 'todos', label: 'Todos', test: () => true },
  { key: 'pendentes', label: 'Não estudados', test: (t: TopicRow) => t.status !== 'estudado' },
  { key: 'fracos', label: 'Pontos fracos', test: (t: TopicRow) => t.weak },
  { key: 'semquestoes', label: 'Estudados sem questões', test: (t: TopicRow) => t.noQuestions },
] as const;
type FilterKey = (typeof FILTERS)[number]['key'];

const STATUS: Record<TopicStatus, { label: string; icon: typeof Check; color: string }> = {
  estudado: { label: 'Estudado', icon: Check, color: 'var(--lime)' },
  andamento: { label: 'Em andamento', icon: CircleDashed, color: 'var(--cyan)' },
  pendente: { label: 'Não estudado', icon: Circle, color: 'var(--faint)' },
  fora: { label: 'Fora do cronograma', icon: CircleOff, color: 'var(--orange)' },
};
const accBadge = (acc: number) => (acc >= GOOD ? 'lime' : acc >= WEAK ? 'cyan' : 'orange');
const pct = (acc: number) => `${Math.round(acc * 100)}%`;

function TopicItem({ t }: { t: TopicRow }) {
  const [open, setOpen] = useState(false);
  const s = STATUS[t.status];
  return (
    <li className="vert-topic">
      <s.icon size={16} style={{ color: s.color, flexShrink: 0, marginTop: 2 }} aria-label={s.label} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <button className={'vert-text' + (open ? ' open' : '')} onClick={() => setOpen(!open)} title={open ? undefined : t.text}>{t.text}</button>
        <div className="vert-meta muted small">
          <span>{s.label}{t.sessionsTotal > 1 ? ` · ${t.sessionsDone} de ${t.sessionsTotal} sessões` : ''}</span>
          {t.attempts > 0 && <span className={'badge ' + accBadge(t.acc!)}>{t.correct}/{t.attempts} · {pct(t.acc!)}</span>}
          {t.weak && <span className="badge orange">ponto fraco</span>}
          {t.noQuestions && <span className="badge violet">sem questões</span>}
          {t.lastSeen && <span className="faint">visto em {fmtDate(t.lastSeen.slice(0, 10))}</span>}
        </div>
      </div>
      {t.taskId && <Link className="btn ghost sm" to={`/estudo/${t.taskId}`}>Estudar</Link>}
    </li>
  );
}

// Todos os tópicos do edital, por matéria, com o que já foi estudado e o desempenho em cada um.
export function VerticalizedPage() {
  const active = useActivePlan();
  const data = useVerticalized(active.data);
  const [filter, setFilter] = useState<FilterKey>('todos');
  const subtitle = 'Tudo o que cai na prova, tópico por tópico.';

  if (active.isLoading || (active.data && data.isLoading)) return <Shell title="Edital" subtitle={subtitle}><div className="spinner" /></Shell>;
  if (!active.data) return <Shell title="Edital" subtitle={subtitle}><div className="glass card muted">Monte um cronograma para acompanhar o edital. <Link to="/concursos">Ir para Concursos</Link></div></Shell>;
  if (data.isError) return <Shell title="Edital" subtitle={subtitle}><p className="error">{(data.error as Error).message}</p></Shell>;

  const { subjects, focus, summary } = data.data!;
  const test = FILTERS.find((f) => f.key === filter)!.test;
  const visible = subjects.map((s, i) => ({ s, i, topics: s.topics.filter(test) })).filter((x) => x.topics.length);

  const rail = (
    <>
      <section>
        <h3>Edital estudado</h3>
        <div className="glass card" style={{ display: 'grid', gap: 8 }}>
          <strong style={{ fontSize: 30, color: 'var(--lime)' }}>{summary.total ? Math.round((summary.studied / summary.total) * 100) : 0}%</strong>
          <div className="bar"><span style={{ width: `${summary.total ? (summary.studied / summary.total) * 100 : 0}%`, background: 'var(--lime)' }} /></div>
          <span className="muted small">{summary.studied} de {summary.total} tópicos · {summary.inProgress} em andamento</span>
        </div>
      </section>
      <section>
        <h3>Questões do cronograma</h3>
        <div className="stats">
          <div className="stat"><strong style={{ color: 'var(--violet)' }}>{summary.attempts}</strong><span>questões</span></div>
          <div className="stat"><strong style={{ color: summary.acc != null && summary.acc >= WEAK ? 'var(--lime)' : 'var(--orange)' }}>{summary.acc != null ? pct(summary.acc) : '—'}</strong><span>acerto</span></div>
          <div className="stat"><strong style={{ color: 'var(--orange)' }}>{summary.weak}</strong><span>fracos</span></div>
        </div>
      </section>
      {!!focus.length && (
        <section>
          <h3>Onde focar</h3>
          <div className="grid" style={{ gap: 8 }}>
            {focus.map((t) => (
              <Link key={t.id} className="glass vert-focus" to={t.taskId ? `/estudo/${t.taskId}` : '/edital'}>
                <span className="vert-focus-text">{t.text}</span>
                <span className="muted small">{t.subjectName} · {pct(t.acc!)} em {t.attempts} questões</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );

  return (
    <Shell title="Edital" subtitle={subtitle} rail={rail}>
      <div className="segmented" style={{ marginBottom: 16 }}>
        {FILTERS.map((f) => <button key={f.key} className={filter === f.key ? 'on' : ''} onClick={() => setFilter(f.key)}>{f.label}</button>)}
      </div>
      {!visible.length && <div className="glass card muted">Nenhum tópico neste filtro.</div>}
      <div className="grid" style={{ gap: 12 }}>
        {visible.map(({ s, i, topics }) => (
          <details key={s.id} className="glass card" open={filter !== 'todos' || visible.length === 1}>
            <summary className="vert-subject">
              <SubjectIcon name={s.name} index={i} style={{ width: 36, height: 36 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>{s.name}{s.is_core && <span className="badge violet" style={{ marginLeft: 8 }}>específica</span>}</div>
                <div className="bar" style={{ marginTop: 6 }}><span style={{ width: `${s.topics.length ? (s.studied / s.topics.length) * 100 : 0}%`, background: subjectColor(i) }} /></div>
                <div className="muted small" style={{ marginTop: 6, fontWeight: 400 }}>
                  {s.studied} de {s.topics.length} tópicos{s.questions ? ` · ${s.questions} questões na prova` : ''}{s.attempts ? ` · ${pct(s.acc!)} de acerto em ${s.attempts}` : ''}
                </div>
              </div>
            </summary>
            <ul className="vert-list">{topics.map((t) => <TopicItem key={t.id} t={t} />)}</ul>
          </details>
        ))}
      </div>
      <p className="faint small" style={{ marginTop: 14 }}>Contam as questões feitas nas sessões do cronograma; simulados, revisão de erros e questões livres ficam na aba Desempenho. Uma sessão com vários tópicos conta suas questões para todos eles.</p>
    </Shell>
  );
}
