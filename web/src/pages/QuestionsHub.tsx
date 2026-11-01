import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Layers, ListChecks, Plus, RotateCcw, Search, Trash2, Trophy, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ERROR_REASONS } from '../../../shared/domain/replan.ts';
import { resolveMateria } from '../../../shared/qbank/materias.ts';
import { QuestionsPanel } from '../components/QuestionsPanel.tsx';
import { SearchSelect } from '../components/SearchSelect.tsx';
import { Shell } from '../components/Shell.tsx';
import { SimuladoStarter } from '../components/SimuladoStarter.tsx';
import { useActivePlan } from '../lib/plans.ts';
import {
  createSimulado, deleteCard, filterLists, reviewCard, useAttemptStats, useDueCounts, useFlashcards, useMappedMaterias, useMateriaOptions, useSimulados,
  type Ctx, type FreeFilters,
} from '../lib/practice.ts';

const TABS = [
  { key: 'resolver', label: 'Resolver', icon: Search },
  { key: 'revisar', label: 'Revisar erros', icon: RotateCcw },
  { key: 'flashcards', label: 'Flashcards', icon: Layers },
  { key: 'simulados', label: 'Simulados', icon: Trophy },
  { key: 'desempenho', label: 'Desempenho', icon: BarChart3 },
] as const;
type TabKey = (typeof TABS)[number]['key'];

// Questões fora do cronograma: livres (com filtros), caderno de erros, flashcards, simulados e desempenho.
export function QuestionsHubPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.key === params.get('aba'))?.key ?? 'resolver') as TabKey;
  const due = useDueCounts();
  return (
    <Shell title="Questões" subtitle="Treino livre, revisão dos erros, flashcards e simulados — com desempenho separado do cronograma.">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={'tab' + (tab === t.key ? ' on' : '')} onClick={() => setParams({ aba: t.key })}>
            <t.icon size={16} /> {t.label}
            {t.key === 'revisar' && !!due.data?.errors && <span className="badge orange" style={{ marginLeft: 6 }}>{due.data.errors}</span>}
            {t.key === 'flashcards' && !!due.data?.cards && <span className="badge cyan" style={{ marginLeft: 6 }}>{due.data.cards}</span>}
          </button>
        ))}
      </div>
      {tab === 'resolver' ? <FreePractice /> : tab === 'revisar' ? <ReviewTab count={due.data?.errors ?? 0} />
        : tab === 'flashcards' ? <FlashcardsTab /> : tab === 'simulados' ? <SimuladosTab /> : <PerformanceTab />}
    </Shell>
  );
}

function useDebounced<T>(v: T, ms = 350) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

// Campo de matéria: ao sair, troca o que foi digitado pelo nome oficial, se bater ignorando acento e maiúscula.
function MateriaField({ value, onChange, placeholder }: { value: string; onChange: (materia: string) => void; placeholder: string }) {
  const { options, loading } = useMateriaOptions(value);
  return <SearchSelect label="Matéria" value={value} options={options} loading={loading} placeholder={placeholder} onChange={onChange} onPick={onChange} onBlur={() => { if (value.trim()) onChange(resolveMateria(value, options)); }} />;
}

function FreePractice() {
  const geral = useQuery({ queryKey: ['filtros-geral'], queryFn: () => filterLists.geral(), staleTime: Infinity });
  const mapped = useMappedMaterias();
  const [f, setF] = useState<FreeFilters>({ materia: '', onlyNew: true });
  const [active, setActive] = useState<FreeFilters | null>(null);
  const bq = useDebounced(f.banca ?? '');
  const { options: materias } = useMateriaOptions(f.materia);
  const bancas = useQuery({ queryKey: ['f-bancas', bq], enabled: bq.length >= 2, queryFn: () => filterLists.bancas(bq) });
  const assuntos = useQuery({ queryKey: ['f-assuntos', f.materia], enabled: materias.includes(f.materia) || !!mapped.data?.includes(f.materia), queryFn: () => filterLists.assuntos(f.materia) });
  const set = (p: Partial<FreeFilters>) => setF((cur) => ({ ...cur, ...p }));
  const g = geral.data?.data ?? {};
  // Buscar com texto solto ("portugues") vale pela melhor opção, e o campo passa a mostrar o nome oficial.
  function search() {
    const materia = resolveMateria(f.materia, materias, true), next = { ...f, materia };
    setF(next); setActive(next);
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="glass card filters">
        {!!mapped.data?.length && (
          <div className="chips-row"><span className="muted small">Matérias do seu concurso:</span>
            {mapped.data.map((m) => <button key={m} className={'chip-btn' + (f.materia === m ? ' on' : '')} onClick={() => set({ materia: m, assunto: '' })}>{m}</button>)}
          </div>
        )}
        <div className="row">
          <div className="field"><span>Matéria</span>
            <MateriaField value={f.materia} onChange={(materia) => set(materia === f.materia ? {} : { materia, assunto: '' })} placeholder="Digite para buscar (ex.: português, proc penal)" />
          </div>
          <label className="field">Assunto
            <select className="select" value={f.assunto ?? ''} onChange={(e) => set({ assunto: e.target.value })} disabled={!assuntos.data}>
              <option value="">Todos</option>{assuntos.data?.items.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
        </div>
        <div className="row">
          <div className="field"><span>Banca</span>
            <SearchSelect label="Banca" value={f.banca ?? ''} options={bancas.data?.items ?? []} loading={bancas.isFetching} placeholder="Qualquer" onChange={(banca) => set({ banca })} onPick={(banca) => set({ banca })} />
          </div>
          <label className="field">Ano<select className="select" value={f.ano ?? ''} onChange={(e) => set({ ano: e.target.value })}><option value="">Qualquer</option>{(g.anos ?? []).map((a) => <option key={String(a)} value={String(a)}>{String(a)}</option>)}</select></label>
          <label className="field">Dificuldade<select className="select" value={f.dificuldade ?? ''} onChange={(e) => set({ dificuldade: e.target.value })}><option value="">Qualquer</option>{[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{['Muito fácil', 'Fácil', 'Média', 'Difícil', 'Muito difícil'][d - 1]}</option>)}</select></label>
          <label className="field">Tipo<select className="select" value={f.tipo ?? ''} onChange={(e) => set({ tipo: e.target.value })}><option value="">Todos</option>{(g.tiposQuestao ?? ['multipla escolha', 'Certo ou errado']).map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        </div>
        <div className="row">
          <label className="field">Órgão (contém)<input className="input" value={f.orgao ?? ''} onChange={(e) => set({ orgao: e.target.value })} placeholder="Ex.: TJ SP" /></label>
          <label className="field">Cargo (contém)<input className="input" value={f.cargo ?? ''} onChange={(e) => set({ cargo: e.target.value })} placeholder="Ex.: Escrevente" /></label>
          <label className="check"><input type="checkbox" checked={f.onlyNew !== false} onChange={(e) => set({ onlyNew: e.target.checked })} /> Só questões que nunca respondi</label>
        </div>
        <button className="btn" style={{ justifySelf: 'start' }} disabled={!f.materia.trim()} onClick={search}><Search size={16} /> Buscar questões</button>
      </div>
      {active && <QuestionsPanel key={JSON.stringify(active)} source={{ kind: 'free', filters: active }} paged />}
      <p className="faint small" style={{ margin: 0 }}>Questões livres ficam num histórico próprio (aba Desempenho → Livres) e não alteram o desempenho do cronograma. As erradas entram no caderno de erros.</p>
    </div>
  );
}

function ReviewTab({ count }: { count: number }) {
  const [started, setStarted] = useState(false);
  if (started) return <QuestionsPanel source={{ kind: 'review' }} paged />;
  return (
    <div className="glass card" style={{ display: 'grid', gap: 12 }}>
      <h3 style={{ margin: 0 }}>Caderno de erros</h3>
      <p className="muted" style={{ margin: 0 }}>Toda questão que você erra volta em 1 dia; acertando, volta em 7 e depois em 30 dias, e sai do caderno. Revisar não gasta créditos: as questões já estão guardadas.</p>
      <button className="btn" style={{ justifySelf: 'start' }} disabled={!count} onClick={() => setStarted(true)}><RotateCcw size={16} /> {count ? `Revisar ${count} questão(ões) de hoje` : 'Nada para revisar hoje'}</button>
    </div>
  );
}

function FlashcardsTab() {
  const qc = useQueryClient();
  const [all, setAll] = useState(false);
  const cards = useFlashcards(all);
  const [flip, setFlip] = useState(false);
  const [i, setI] = useState(0);
  const list = cards.data ?? [], c = list[i];
  async function rate(knew: boolean) {
    if (!c) return;
    await reviewCard(c, knew);
    setFlip(false);
    if (!all) { await qc.invalidateQueries({ queryKey: ['flashcards'] }); void qc.invalidateQueries({ queryKey: ['due-counts'] }); setI(0); } else setI(i + 1);
  }
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="segmented" style={{ justifySelf: 'start' }}>
        <button className={!all ? 'on' : ''} onClick={() => { setAll(false); setI(0); }}>Para revisar hoje</button>
        <button className={all ? 'on' : ''} onClick={() => { setAll(true); setI(0); }}>Todos</button>
      </div>
      {!c ? <div className="glass card muted">{all ? 'Nenhum flashcard ainda. Eles nascem das questões que você erra e dos mnemônicos que você abre.' : 'Nenhum flashcard para hoje. 🎉'}</div> : (
        <>
          <button className={'flashcard glass' + (flip ? ' flipped' : '')} onClick={() => setFlip(!flip)} aria-label="Virar cartão">
            <span className="badge">{c.kind === 'mnemonic' ? 'Mnemônico' : 'Questão errada'} · caixa {c.box}</span>
            <div className="fc-text">{(flip ? c.back : c.front).split('\n').map((l, j) => <p key={j}>{l}</p>)}</div>
            <span className="faint small">{flip ? 'Verso' : 'Toque para ver a resposta'}</span>
          </button>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn ghost" disabled={!flip} onClick={() => rate(false)}><X size={16} /> Errei</button>
            <button className="btn" disabled={!flip} onClick={() => rate(true)}>Acertei</button>
            <span className="faint small">{i + 1} de {list.length}</span>
            <div style={{ flex: 1 }} />
            <button className="icon-btn" title="Excluir cartão" aria-label="Excluir cartão" onClick={async () => { await deleteCard(c.id); await qc.invalidateQueries({ queryKey: ['flashcards'] }); }}><Trash2 size={16} /></button>
          </div>
        </>
      )}
    </div>
  );
}

function SimuladosTab() {
  const active = useActivePlan();
  const sims = useSimulados();
  return (
    <div className="grid" style={{ gap: 16 }}>
      {active.data && <SimuladoStarter planId={active.data.plan.id} />}
      <CustomSimulado />
      <div className="section-title" style={{ margin: '10px 0 0' }}><h2>Meus simulados</h2></div>
      {!sims.data?.length ? <div className="glass card muted">Nenhum simulado ainda.</div> : sims.data.map((s) => (
        <Link key={s.id} to={`/simulados/${s.id}`} className="glass card material-row" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div style={{ flex: 1 }}><strong>{s.title}</strong><div className="muted small">{new Date(s.started_at).toLocaleDateString('pt-BR')} · {s.config.timed ? `${s.config.minutes} min` : 'sem tempo'}</div></div>
          {s.result ? <span className={'badge ' + (s.result.passed ? 'lime' : 'orange')}>{s.result.pct}%</span> : <span className="badge cyan">Em andamento</span>}
        </Link>
      ))}
    </div>
  );
}

function CustomSimulado() {
  const [rows, setRows] = useState<{ materia: string; count: number }[]>([{ materia: '', count: 10 }]);
  const [banca, setBanca] = useState('');
  const [tipo, setTipo] = useState('');
  const [timed, setTimed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const total = rows.reduce((a, r) => a + (r.materia ? r.count : 0), 0);
  async function start() {
    setBusy(true); setError('');
    try {
      const r = await createSimulado({ kind: 'custom', subjects: rows.filter((x) => x.materia.trim()), banca, tipo, timed, minutes: total * 3 });
      window.location.assign(`/simulados/${r.id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return (
    <details className="glass card">
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}><Plus size={15} style={{ verticalAlign: -2 }} /> Simulado personalizado</summary>
      <div className="grid" style={{ gap: 12, marginTop: 14 }}>
        {rows.map((r, i) => (
          <div key={i} className="row">
            <div className="field"><span>Matéria</span><MateriaField value={r.materia} onChange={(materia) => setRows((cur) => cur.map((x, j) => (j === i ? { ...x, materia } : x)))} placeholder="Digite para buscar (ex.: português)" /></div>
            <label className="field" style={{ flex: '0 1 110px' }}>Questões<input className="input" type="number" min={1} max={50} value={r.count} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, count: Number(e.target.value) || 1 } : x)))} /></label>
            {rows.length > 1 && <button className="icon-btn" aria-label="Remover matéria" onClick={() => setRows(rows.filter((_, j) => j !== i))}><X size={16} /></button>}
          </div>
        ))}
        <button className="btn ghost sm" style={{ justifySelf: 'start' }} onClick={() => setRows([...rows, { materia: '', count: 10 }])}><Plus size={14} /> Matéria</button>
        <div className="row">
          <label className="field">Banca (opcional)<input className="input" value={banca} onChange={(e) => setBanca(e.target.value)} placeholder="Ex.: VUNESP" /></label>
          <label className="field">Tipo<select className="select" value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Todos</option><option value="multipla escolha">Múltipla escolha</option><option value="Certo ou errado">Certo ou errado</option></select></label>
          <label className="check"><input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} /> Com cronômetro (3 min por questão)</label>
        </div>
        <button className="btn" style={{ justifySelf: 'start' }} disabled={busy || !total} onClick={start}>{busy ? <><span className="spinner" /> Montando…</> : `Começar (${total} questões)`}</button>
        {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      </div>
    </details>
  );
}

const CTX: { key: Ctx | 'all'; label: string }[] = [
  { key: 'plan', label: 'Cronograma' }, { key: 'free', label: 'Livres' }, { key: 'simulado', label: 'Simulados' }, { key: 'review', label: 'Revisão de erros' }, { key: 'all', label: 'Tudo' },
];
export function PerformanceTab() {
  const stats = useAttemptStats();
  const [ctx, setCtx] = useState<Ctx | 'all'>('plan');
  const rows = useMemo(() => (stats.data ?? []).filter((a) => ctx === 'all' || a.context === ctx), [stats.data, ctx]);
  const right = rows.filter((a) => a.correct).length, pct = rows.length ? Math.round((right / rows.length) * 100) : 0;
  const by = new Map<string, { t: number; c: number }>();
  for (const a of rows) { const k = a.materia || 'Sem matéria', e = by.get(k) ?? { t: 0, c: 0 }; e.t++; if (a.correct) e.c++; by.set(k, e); }
  const week = rows.filter((a) => Date.now() - new Date(a.created_at).getTime() < 7 * 864e5).length;
  const wrong = rows.filter((a) => !a.correct), marked = wrong.filter((a) => a.error_reason);
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="segmented" style={{ justifySelf: 'start' }}>{CTX.map((c) => <button key={c.key} className={ctx === c.key ? 'on' : ''} onClick={() => setCtx(c.key)}>{c.label}</button>)}</div>
      <div className="stats glass card">
        <div className="stat"><strong style={{ color: 'var(--violet)' }}>{rows.length}</strong><span>questões</span></div>
        <div className="stat"><strong style={{ color: pct >= 75 ? 'var(--lime)' : 'var(--orange)' }}>{rows.length ? pct + '%' : '—'}</strong><span>de acerto</span></div>
        <div className="stat"><strong style={{ color: 'var(--cyan)' }}>{by.size}</strong><span>matérias</span></div>
      </div>
      <p className="faint small" style={{ margin: 0 }}><ListChecks size={12} style={{ verticalAlign: -2 }} /> {week} questões nos últimos 7 dias.</p>
      {!rows.length ? <div className="glass card muted">Sem questões neste contexto ainda.</div> : (
        <table className="sum-table glass"><thead><tr><th>Matéria</th><th>Acertos</th><th /></tr></thead><tbody>
          {[...by].sort((a, b) => a[1].c / a[1].t - b[1].c / b[1].t).map(([m, e]) => (
            <tr key={m}><td>{m}</td><td>{e.c}/{e.t} · {Math.round((e.c / e.t) * 100)}%</td><td style={{ width: '35%' }}><div className="bar"><span style={{ width: `${(e.c / e.t) * 100}%`, background: e.c / e.t >= 0.75 ? 'var(--lime)' : 'var(--orange)' }} /></div></td></tr>
          ))}
        </tbody></table>
      )}
      {!!marked.length && (
        <section className="glass card" style={{ display: 'grid', gap: 10 }}>
          <strong>Por que você erra</strong>
          {ERROR_REASONS.map((r) => {
            const n = marked.filter((a) => a.error_reason === r.key).length, share = Math.round((n / marked.length) * 100);
            return (
              <div key={r.key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}><span>{r.label}</span><span className="muted">{n} · {share}%</span></div>
                <div className="bar" style={{ marginTop: 5 }}><span style={{ width: `${share}%`, background: 'var(--orange)' }} /></div>
              </div>
            );
          })}
          <span className="faint small">{marked.length} de {wrong.length} erros com motivo marcado.</span>
        </section>
      )}
    </div>
  );
}
