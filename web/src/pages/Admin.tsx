import { Inbox, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '../components/Shell.tsx';
import { useAdminOverview, type AdminOverview } from '../lib/admin.ts';

// Nome de cada operação de IA registrada em ai_usage, como o admin reconhece.
const OPERATIONS: Record<string, string> = {
  qbank_fetch: 'Busca de questões (cronograma)', qbank_free: 'Busca de questões (treino livre)', qbank_explain: 'Explicação de questão',
  qbank_mnemonic: 'Mnemônico de questão', plan_sessions: 'Montagem do cronograma', plan_strategy: 'Estratégia do cronograma',
  study_guide: 'Apostilas', notice_extract: 'Leitura de edital', notice_roles: 'Cargos do edital', material_map: 'Mapa de PDF',
  hot_topics: 'O que mais cai', juris_picks: 'Jurisprudência', source_picks: 'Fontes', source_embed: 'Fontes (índice)',
  discursive_prompt: 'Discursiva: tema', discursive_grade: 'Discursiva: correção', guide_voice: 'Voz da apostila', glossary: 'Dicionário', book_refs: 'Referências de livros',
};
const PERIODS = [7, 30, 90];
const usd = (v: number | null | undefined, digits = 2) => (v == null ? '–' : `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`);
const pct = (v: number | null | undefined) => (v == null ? '–' : `${Math.round(v * 100)}%`);
const num = (v: number | null | undefined) => (v == null ? '–' : v.toLocaleString('pt-BR'));
const day = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="adm-tile"><span className="adm-label">{label}</span><strong>{value}</strong>{hint && <span className="faint small">{hint}</span>}</div>;
}

// Barras por dia, uma série por gráfico (cada medida tem sua escala). Passar o mouse ou focar mostra o dia.
function DailyBars({ title, points, value, format }: { title: string; points: AdminOverview['daily']; value: (p: AdminOverview['daily'][number]) => number; format: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1e-9, ...points.map(value));
  const h = hover != null ? points[hover] : null;
  const total = points.reduce((s, p) => s + value(p), 0);
  return (
    <section className="glass card adm-chart">
      <div className="adm-chart-head">
        <h3>{title}</h3>
        <span className="muted small">{h ? `${day(h.d)}: ${format(value(h))}` : `máx. ${format(max === 1e-9 ? 0 : max)} · média ${format(total / Math.max(1, points.length))}`}</span>
      </div>
      <div className="adm-bars" onMouseLeave={() => setHover(null)}>
        {points.map((p, i) => (
          <button key={p.d} className={'adm-bar' + (hover === i ? ' on' : '')} aria-label={`${day(p.d)}: ${format(value(p))}`}
            onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
            <i style={{ height: `${Math.max(value(p) > 0 ? 3 : 0, (value(p) / max) * 100)}%` }} />
          </button>
        ))}
      </div>
      <div className="adm-axis faint small"><span>{points[0] && day(points[0].d)}</span><span>{points.at(-1) && day(points.at(-1)!.d)}</span></div>
    </section>
  );
}

// Painel do admin: quantos usam, o que usam e quanto custa. Só leitura; contas continuam pelo scripts/users.mjs.
export function AdminPage() {
  const [days, setDays] = useState(30);
  const q = useAdminOverview(days);
  const o = q.data;
  return (
    <Shell title="Painel" subtitle="Uso e custo do app (só admin)">
      <div className="grid" style={{ gap: 14 }}>
        <div className="adm-bar-top">
          <div className="segmented">{PERIODS.map((p) => <button key={p} className={days === p ? 'on' : ''} onClick={() => setDays(p)}>{p} dias</button>)}</div>
          <button className="btn ghost sm" disabled={q.isFetching} onClick={() => q.refetch()}><RefreshCw size={14} /> Atualizar</button>
          <Link className="btn ghost sm" to="/relatos"><Inbox size={14} /> Relatos</Link>
        </div>
        {q.isError && <p className="error">{(q.error as Error).message}</p>}
        {!o && !q.isError && <div className="spinner" />}
        {o && <>
          <section className="adm-group">
            <h2>Usuários</h2>
            <div className="adm-tiles">
              <Tile label="Contas ativas" value={num(o.users.total)} hint={o.users.blocked ? `${o.users.blocked} bloqueada(s)` : undefined} />
              <Tile label="Usaram hoje" value={num(o.users.active1d)} />
              <Tile label="Usaram em 7 dias" value={num(o.users.active7d)} />
              <Tile label="Usaram em 30 dias" value={num(o.users.active30d)} />
              <Tile label="Novos em 7 dias" value={num(o.users.new7d)} />
              <Tile label="Parados há 7+ dias" value={num(o.users.inactive7d)} hint="contas sem nenhuma atividade" />
            </div>
          </section>
          <section className="adm-group">
            <h2>Uso nos últimos {o.days} dias</h2>
            <div className="adm-tiles">
              <Tile label="Questões respondidas" value={num(o.usage.questions)} hint={`acerto ${pct(o.usage.accuracy)}`} />
              <Tile label="Tarefas concluídas" value={num(o.usage.tasksDone)} hint={`${num(o.usage.studyHours)} h de estudo marcadas`} />
              <Tile label="Apostilas geradas" value={num(o.usage.guides)} />
              <Tile label="Revisões em cartões" value={num(o.usage.reviews)} hint={o.usage.reviews ? `${num(o.usage.reviewsDone)} terminadas · lembraram ${pct(o.usage.reviewRecall)} · ${num(o.usage.reviewMinutes)} min` : 'conta desde 11/11'} />
              <Tile label="Simulados terminados" value={num(o.usage.simulados)} />
              <Tile label="Discursivas" value={num(o.usage.discursivas)} />
            </div>
          </section>
          <section className="adm-group">
            <h2>Custo de IA</h2>
            <div className="adm-tiles">
              <Tile label="Hoje" value={usd(o.cost.today)} />
              <Tile label={`Últimos ${o.days} dias`} value={usd(o.cost.period)} />
              <Tile label="Por usuário ativo" value={usd(o.cost.perActiveUser)} hint={`no período`} />
              <Tile label="Créditos de questões" value={num(o.cost.credits)} hint="no período" />
            </div>
          </section>
          <div className="adm-charts">
            <DailyBars title="Usuários ativos por dia" points={o.daily} value={(p) => p.active} format={(v) => num(Math.round(v * 10) / 10)} />
            <DailyBars title="Questões respondidas por dia" points={o.daily} value={(p) => p.questions} format={(v) => num(Math.round(v))} />
            <DailyBars title="Custo de IA por dia" points={o.daily} value={(p) => p.usd} format={(v) => usd(v)} />
          </div>
          <section className="glass card">
            <h3 style={{ marginTop: 0 }}>Custo por recurso ({o.days} dias)</h3>
            <div className="guide-table">
              <table className="sum-table adm-table">
                <thead><tr><th>Recurso</th><th>Chamadas</th><th>Erros</th><th>Custo</th><th>% do custo</th><th>Créditos</th></tr></thead>
                <tbody>{o.cost.byOperation.map((r) => (
                  <tr key={r.operation}>
                    <th scope="row">{OPERATIONS[r.operation] ?? r.operation}</th>
                    <td>{num(r.calls)}</td><td>{r.errors ? num(r.errors) : '–'}</td><td>{usd(r.usd)}</td>
                    <td>{o.cost.period ? pct(r.usd / o.cost.period) : '–'}</td><td>{r.credits ? num(r.credits) : '–'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
          <p className="faint small" style={{ margin: 0 }}>"Usou" = qualquer atividade no dia: questão, tarefa concluída, IA, revisão, simulado, discursiva ou vídeo. Inclui a sua conta. Dias no horário de Brasília.</p>
        </>}
      </div>
    </Shell>
  );
}
