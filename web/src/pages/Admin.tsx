import { useQueryClient } from '@tanstack/react-query';
import { Inbox, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '../components/Shell.tsx';
import { refreshOwnBank, useAdminOverview, useOwnBank, type AdminOverview } from '../lib/admin.ts';

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

// Lista de barras horizontais (contagem por categoria), com o número ao lado.
function BarList({ title, items, label = (s) => s }: { title: string; items: { label: string; n: number }[]; label?: (s: string) => string }) {
  const max = Math.max(1, ...items.map((i) => i.n)), total = items.reduce((s, i) => s + i.n, 0);
  return (
    <section className="glass card adm-chart">
      <h3 style={{ margin: 0, fontSize: 14 }}>{title}</h3>
      <div className="adm-hbars">{items.map((i) => (
        <div key={i.label} className="adm-hbar" title={`${label(i.label)}: ${num(i.n)} (${pct(i.n / Math.max(1, total))})`}>
          <span className="adm-hlabel">{label(i.label)}</span>
          <span className="adm-htrack"><i style={{ width: `${(i.n / max) * 100}%` }} /></span>
          <span className="adm-hval">{num(i.n)}</span>
        </div>
      ))}</div>
    </section>
  );
}
const DIFICULDADE: Record<string, string> = { 1: 'Muito fácil', 2: 'Fácil', 3: 'Média', 4: 'Difícil', 5: 'Muito difícil' };
const TIPO: Record<string, string> = { 'multipla escolha': 'Múltipla escolha', 'certo e errado': 'Certo ou errado' };
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '–');

// Banco próprio de questões (apiQuestoes): tamanho, cobertura e quanto os alunos usam.
function OwnBank() {
  const qc = useQueryClient();
  const q = useOwnBank();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function refresh() {
    setBusy(true); setError('');
    try { qc.setQueryData(['admin-own-bank'], await refreshOwnBank()); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (q.isError) return <p className="error">{(q.error as Error).message}</p>;
  if (!q.data) return <div className="spinner" />;
  const s = q.data.snapshot, u = q.data.use30d;
  return <>
    <div className="adm-bar-top">
      <span className="muted small">Retrato de {when(s?.computedAt)} · última importação {when(s?.lastImport)}</span>
      <button className="btn ghost sm" disabled={busy} onClick={refresh}>{busy ? <><span className="spinner" /> Recalculando (uns 20 s)…</> : <><RefreshCw size={14} /> Recalcular</>}</button>
      {error && <span className="error small">{error}</span>}
    </div>
    {s && <section className="adm-group">
      <h2>Acervo</h2>
      <div className="adm-tiles">
        <Tile label="Questões próprias" value={num(s.total)} hint={`+ ${num(s.quest)} guardadas da Quest API`} />
        <Tile label="Provas" value={num(s.provas)} />
        <Tile label="Matérias" value={num(s.materias)} />
        <Tile label="Assuntos" value={num(s.assuntos)} hint={s.semAssunto ? `${num(s.semAssunto)} questões sem assunto` : undefined} />
        <Tile label="Com explicação da IA" value={num(s.explained)} hint="geradas quando o aluno pede" />
      </div>
    </section>}
    <section className="adm-group">
      <h2>Uso nos últimos 30 dias</h2>
      <div className="adm-tiles">
        <Tile label="Respostas no banco próprio" value={num(u.ownAnswers)} hint={`${pct(u.answers ? u.ownAnswers / u.answers : null)} de todas as ${num(u.answers)} respostas`} />
        <Tile label="Acerto" value={pct(u.ownAccuracy)} />
        <Tile label="Questões diferentes usadas" value={num(u.ownDistinct)} hint={s ? `${pct(u.ownDistinct / Math.max(1, s.total))} do acervo` : undefined} />
        <Tile label="Alunos" value={num(u.ownUsers)} />
      </div>
    </section>
    {s && <>
      <div className="adm-charts">
        <BarList title="Por banca (15 maiores)" items={s.byBanca} />
        <BarList title="Por ano" items={[...s.byAno].reverse()} />
        <BarList title="Por tipo" items={s.byTipo} label={(t) => TIPO[t] ?? t} />
        <BarList title="Por dificuldade" items={s.byDificuldade} label={(d) => DIFICULDADE[d] ?? 'Sem dificuldade'} />
      </div>
      <section className="glass card">
        <h3 style={{ marginTop: 0 }}>Matérias com mais questões (30 maiores)</h3>
        <div className="guide-table">
          <table className="sum-table adm-table">
            <thead><tr><th>Matéria</th><th>Questões</th><th>Assuntos</th><th>Respondidas (30 dias)</th></tr></thead>
            <tbody>{s.byMateria.map((m) => (
              <tr key={m.label}><th scope="row">{m.label}</th><td>{num(m.n)}</td><td>{num(m.assuntos)}</td><td>{u.byMateria[m.label] ? num(u.byMateria[m.label]) : '–'}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </>}
  </>;
}

// Painel do admin: quantos usam, o que usam e quanto custa. Só leitura; contas continuam pelo scripts/users.mjs.
export function AdminPage() {
  const [tab, setTab] = useState<'geral' | 'banco'>('geral');
  const [days, setDays] = useState(30);
  const q = useAdminOverview(days);
  const o = tab === 'geral' ? q.data : undefined;
  return (
    <Shell title="Painel" subtitle="Uso e custo do app (só admin)">
      <div className="grid" style={{ gap: 14 }}>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'geral'} className={'tab' + (tab === 'geral' ? ' on' : '')} onClick={() => setTab('geral')}>Visão geral</button>
          <button role="tab" aria-selected={tab === 'banco'} className={'tab' + (tab === 'banco' ? ' on' : '')} onClick={() => setTab('banco')}>Banco próprio</button>
          <Link className="btn ghost sm" style={{ marginLeft: 'auto' }} to="/relatos"><Inbox size={14} /> Relatos</Link>
        </div>
        {tab === 'banco' && <OwnBank />}
        {tab === 'geral' && <div className="adm-bar-top">
          <div className="segmented">{PERIODS.map((p) => <button key={p} className={days === p ? 'on' : ''} onClick={() => setDays(p)}>{p} dias</button>)}</div>
          <button className="btn ghost sm" disabled={q.isFetching} onClick={() => q.refetch()}><RefreshCw size={14} /> Atualizar</button>
        </div>}
        {tab === 'geral' && q.isError && <p className="error">{(q.error as Error).message}</p>}
        {tab === 'geral' && !o && !q.isError && <div className="spinner" />}
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
