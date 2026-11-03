import { useState } from 'react';
import type { ScoreGoal } from '../../../shared/domain/adaptive.ts';
import type { WeekPoint } from '../../../shared/domain/evolution.ts';

const W = 640, H = 220, PAD = { top: 14, right: 92, bottom: 28, left: 40 };
const fmtWeek = (w: string) => `${w.slice(8, 10)}/${w.slice(5, 7)}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

// Acerto por semana contra o mínimo e a meta do concurso. Linha única (o título diz o que é); mínimo e meta tracejados e
// rotulados na ponta. Semana sem questão não liga a linha. Passar o mouse (ou focar o ponto) mostra a semana.
export function EvolutionChart({ points, goal, title }: { points: WeekPoint[]; goal: ScoreGoal; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const plotW = W - PAD.left - PAD.right, plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => PAD.top + (1 - v) * plotH;
  // Segmentos entre semanas com questões seguidas.
  const segments: string[] = [];
  let cur: string[] = [];
  points.forEach((p, i) => {
    if (p.acc == null) { if (cur.length > 1) segments.push(cur.join(' ')); cur = []; return; }
    cur.push(`${cur.length ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.acc).toFixed(1)}`);
  });
  if (cur.length > 1) segments.push(cur.join(' '));
  const labelEvery = Math.ceil(points.length / 6);
  const h = hover != null ? points[hover] : null;
  const refs = [{ v: goal.target, label: `meta ${pct(goal.target)}`, color: 'var(--lime)' }, { v: goal.min, label: `${goal.fromCutoff ? 'corte' : 'mínimo'} ${pct(goal.min)}`, color: 'var(--cyan)' }];
  // Rótulos da meta e do mínimo com pelo menos 13px entre si (meta perto do corte, como 95% e 90%).
  const gap = Math.max(0, 13 - (y(goal.min) - y(goal.target))) / 2;
  const labelY = [y(goal.target) - gap, y(goal.min) + gap];

  return (
    <figure className="glass card evo" style={{ margin: 0 }}>
      <figcaption className="evo-head"><strong>{title}</strong><span className="muted small">acerto por semana</span></figcaption>
      <div className="evo-plot" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: acerto por semana, com ${refs.map((r) => r.label).join(' e ')}`}
          onMouseMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect(), mx = ((e.clientX - box.left) / box.width) * W;
            let best = -1, dist = Infinity;
            points.forEach((p, i) => { if (p.acc != null && Math.abs(x(i) - mx) < dist) { dist = Math.abs(x(i) - mx); best = i; } });
            setHover(best >= 0 ? best : null);
          }}>
          {[0, 0.5, 1].map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--line)" />
              <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" className="evo-axis">{pct(v)}</text>
            </g>
          ))}
          {refs.map((r, i) => (
            <g key={r.label}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(r.v)} y2={y(r.v)} stroke={r.color} strokeWidth={1.5} strokeDasharray="5 5" opacity={0.8} />
              <text x={W - PAD.right + 8} y={labelY[i]! + 4} className="evo-ref">{r.label}</text>
            </g>
          ))}
          {points.map((p, i) => i % labelEvery === 0 || i === points.length - 1 ? <text key={p.week} x={x(i)} y={H - 8} textAnchor="middle" className="evo-axis">{fmtWeek(p.week)}</text> : null)}
          {h && hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--line-2)" />}
          {segments.map((d) => <path key={d} d={d} fill="none" stroke="var(--violet)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
          {points.map((p, i) => p.acc == null ? null : (
            <circle key={p.week} cx={x(i)} cy={y(p.acc)} r={hover === i ? 6 : 4} fill="var(--violet)" stroke="var(--bg)" strokeWidth={2}
              tabIndex={0} aria-label={`Semana de ${fmtWeek(p.week)}: ${pct(p.acc)}, ${p.correct} de ${p.total}`} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
          ))}
        </svg>
        {h && hover != null && h.acc != null && (
          <div className="evo-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(h.acc) / H) * 100}%` }} role="status">
            <strong>{pct(h.acc)}</strong> <span className="muted">semana de {fmtWeek(h.week)}</span>
            <div className="muted small">{h.correct} de {h.total} questões</div>
          </div>
        )}
      </div>
      <details className="evo-table">
        <summary className="muted small">Ver em tabela</summary>
        <table className="sum-table"><thead><tr><th>Semana</th><th>Questões</th><th>Acerto</th></tr></thead><tbody>
          {points.filter((p) => p.total).map((p) => <tr key={p.week}><td>{fmtWeek(p.week)}</td><td>{p.correct}/{p.total}</td><td>{pct(p.acc!)}</td></tr>)}
        </tbody></table>
      </details>
    </figure>
  );
}
