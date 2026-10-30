import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Shell } from '../components/Shell.tsx';
import { Steps, SubjectIcon } from '../components/ui.tsx';
import { approveNotice, useReview, type Draft, type DraftSubject } from '../lib/notices.ts';

const STAGE_LABEL: Record<string, string> = { objetiva: 'Prova objetiva', discursiva: 'Discursiva', titulos: 'Títulos', pratica: 'Prática', fisica: 'Física', outra: 'Outra etapa' };

// Conferência dos dados lidos pela IA: tudo editável; "Confirmar" grava de uma vez (approve_notice).
export function ReviewPage() {
  const { noticeId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const review = useReview(noticeId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (review.data && !draft) setDraft(review.data.draft); }, [review.data, draft]);

  if (review.isError) return <Shell title="Conferência"><p className="error">{(review.error as Error).message}</p></Shell>;
  if (!review.data || !draft) return <Shell title="Conferência"><div className="spinner" /></Shell>;
  const { extraction, usage, notice, hasPlan } = review.data;

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const setSubject = (i: number, patch: Partial<DraftSubject>) =>
    set({ subjects: draft.subjects.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const topicsCount = draft.subjects.reduce((a, s) => a + s.topics.length, 0);
  const questions = draft.subjects.reduce((a, s) => a + s.questions, 0);

  async function confirm() {
    if (!draft) return;
    setBusy(true); setError('');
    try {
      await approveNotice(notice.id, extraction?.id ?? null, draft);
      await qc.invalidateQueries();
      navigate(`/concursos/${notice.id}/questionario`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const rail = (
    <>
      <section>
        <h3>Resumo</h3>
        <div className="stats">
          <div className="stat"><strong style={{ color: 'var(--violet)' }}>{draft.subjects.length}</strong><span>matérias</span></div>
          <div className="stat"><strong style={{ color: 'var(--cyan)' }}>{topicsCount}</strong><span>tópicos</span></div>
          <div className="stat"><strong style={{ color: 'var(--orange)' }}>{draft.totalQuestions || questions || '—'}</strong><span>questões</span></div>
        </div>
      </section>
      {!!extraction?.warnings.length && (
        <section>
          <h3>Confira</h3>
          <div className="grid" style={{ gap: 10 }}>
            {extraction.warnings.map((w, i) => <div key={i} className="warning-card"><AlertTriangle /><span>{w.message}</span></div>)}
          </div>
        </section>
      )}
      {!!draft.structure.blocks.length && (
        <section>
          <h3>Estrutura da prova</h3>
          <div className="grid" style={{ gap: 10 }}>
            {draft.structure.blocks.map((b, i) => (
              <div key={i} className="glass" style={{ padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><strong style={{ fontSize: 14 }}>{b.name}</strong><span className="badge cyan">{b.questions} q.</span></div>
                {b.rule && <div className="faint small" style={{ marginTop: 4 }}>{b.rule}</div>}
              </div>
            ))}
            <div className="muted small">{draft.structure.stages.map((s) => STAGE_LABEL[s.kind] ?? s.kind).join(' · ')}</div>
          </div>
        </section>
      )}
      {extraction && (
        <section>
          <h3>Leitura da IA</h3>
          <p className="faint small" style={{ margin: 0 }}>
            {extraction.model} · {extraction.prompt_version}
            {usage?.latency_ms ? ` · ${Math.round(usage.latency_ms / 1000)}s` : ''}
            {usage?.cost_usd != null ? ` · US$ ${Number(usage.cost_usd).toFixed(4)}` : ''}
          </p>
        </section>
      )}
    </>
  );

  return (
    <Shell title="Conferência" subtitle="Confira o que a IA leu do edital. Tudo pode ser corrigido antes de seguir." rail={rail}>
      <Steps current={1} />
      <div className="hero" style={{ display: 'grid', gap: 14 }}>
        <label className="field">Nome do plano
          <input className="input" value={draft.title} onChange={(e) => set({ title: e.target.value })} style={{ fontSize: 20, fontWeight: 600 }} />
        </label>
        <div className="row">
          <label className="field">Órgão<input className="input" value={draft.organization} onChange={(e) => set({ organization: e.target.value })} /></label>
          <label className="field">Cargo<input className="input" value={draft.role} onChange={(e) => set({ role: e.target.value })} /></label>
        </div>
        <div className="row">
          <label className="field">Banca<input className="input" value={draft.board} onChange={(e) => set({ board: e.target.value })} /></label>
          <label className="field">Data da prova<input className="input" type="date" value={draft.examDate} onChange={(e) => set({ examDate: e.target.value })} /></label>
          <label className="field">Questões na prova<input className="input" type="number" min={0} value={draft.totalQuestions} onChange={(e) => set({ totalQuestions: Number(e.target.value) || 0 })} /></label>
        </div>
        {!!draft.structure.otherRoles.length && <p className="faint small" style={{ margin: 0 }}>Outros cargos neste edital: {draft.structure.otherRoles.join(' · ')}</p>}
      </div>

      <div className="section-title"><h2>Matérias</h2><span className="badge violet">{draft.subjects.length}</span></div>
      <div className="grid">
        {draft.subjects.map((s, i) => (
          <div key={i} className="glass subject-edit">
            <div className="subject-edit-head">
              <SubjectIcon name={s.name} index={i} />
              <input className="input" aria-label="Nome da matéria" value={s.name} onChange={(e) => setSubject(i, { name: e.target.value })} />
              <button className="icon-btn" title="Remover matéria" aria-label={`Remover ${s.name}`} onClick={() => set({ subjects: draft.subjects.filter((_, j) => j !== i) })}><Trash2 size={17} /></button>
            </div>
            <div className="row">
              <label className="field">Bloco<input className="input" value={s.block} onChange={(e) => setSubject(i, { block: e.target.value })} /></label>
              <label className="field" style={{ flex: '0 1 120px' }}>Questões<input className="input" type="number" min={0} value={s.questions} onChange={(e) => setSubject(i, { questions: Number(e.target.value) || 0 })} /></label>
              <label className="field" style={{ flex: '0 1 200px' }}>Peso
                <select className="select" value={s.weight} onChange={(e) => setSubject(i, { weight: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5].map((w) => <option key={w} value={w}>{w}{w === 1 ? ' · pouco cobrada' : w === 5 ? ' · muito cobrada' : ''}</option>)}
                </select>
              </label>
              <label className="check"><input type="checkbox" checked={s.core} onChange={(e) => setSubject(i, { core: e.target.checked })} /> Específica do cargo</label>
            </div>
            <details>
              <summary className="muted" style={{ cursor: 'pointer' }}>{s.topics.length} tópico(s) do conteúdo programático</summary>
              <textarea className="textarea" style={{ marginTop: 10, minHeight: 160 }} aria-label={`Tópicos de ${s.name}`}
                value={s.topics.map((t) => t.text).join('\n')}
                onChange={(e) => {
                  // Um tópico por linha; a página do PDF é mantida para as linhas que não mudaram.
                  const pages = new Map(s.topics.map((t) => [t.text, t.page]));
                  setSubject(i, { topics: e.target.value.split('\n').map((text) => ({ text, page: pages.get(text) ?? 0 })) });
                }} />
            </details>
          </div>
        ))}
        <button className="btn ghost" style={{ justifySelf: 'start' }}
          onClick={() => set({ subjects: [...draft.subjects, { name: 'Nova matéria', block: '', questions: 0, core: false, weight: 2, topics: [] }] })}>
          <Plus size={18} /> Adicionar matéria
        </button>
      </div>

      {!!draft.notes.length && (
        <>
          <div className="section-title"><h2>Regras do edital</h2></div>
          <div className="glass card"><ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>{draft.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></div>
        </>
      )}

      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginTop: 28 }}>
        {hasPlan
          ? <span className="muted">Este edital já tem cronograma; as matérias ficam fixas. Para mudar horas ou níveis, use "Refazer cronograma".</span>
          : <button className="btn" disabled={busy} onClick={confirm}><CheckCircle2 size={18} /> {busy ? 'Salvando…' : 'Confirmar e seguir'}</button>}
        {error && <span className="error" role="alert">{error}</span>}
      </div>
    </Shell>
  );
}
