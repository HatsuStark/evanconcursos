import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FileText, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { EDUCATION_LEVELS } from '../../../shared/ai/notice.ts';
import { Shell } from '../components/Shell.tsx';
import { Steps, SubjectIcon } from '../components/ui.tsx';
import { approveNotice, openNoticePdf, startCorrection, useReview, type Draft, type DraftSubject } from '../lib/notices.ts';

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
  const { extraction, notice, hasPlan } = review.data;

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const setSubject = (i: number, patch: Partial<DraftSubject>) =>
    set({ subjects: draft.subjects.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const topicsCount = draft.subjects.reduce((a, s) => a + s.topics.length, 0);
  const questions = draft.subjects.reduce((a, s) => a + s.questions, 0);
  // Matérias agrupadas por bloco, na ordem do edital: quando o edital dá só o total do bloco, a quantidade aparece uma vez,
  // no bloco, e não como "0" em cada matéria.
  const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const blockQuestions = (name: string) => {
    // "Bloco I" casa com "Bloco I – Língua Portuguesa", mas não com "Bloco II".
    const prefix = (a: string, b: string) => !!b && (a === b || a.startsWith(b + ' ') || a.startsWith(b + ':'));
    const b = draft.structure.blocks.find((x) => norm(x.name) === norm(name)) ?? draft.structure.blocks.find((x) => prefix(norm(x.name), norm(name)) || prefix(norm(name), norm(x.name)));
    return b?.questions ?? 0;
  };
  const groups = [...new Set(draft.subjects.map((s) => s.block.trim()))].map((name) => {
    const items = draft.subjects.map((s, i) => ({ s, i })).filter((x) => x.s.block.trim() === name);
    return { name, items, questions: blockQuestions(name) || items.reduce((n, x) => n + x.s.questions, 0) };
  });
  const pages = draft.subjects.flatMap((s) => s.topics.map((t) => t.page)).filter((p) => p > 0);
  const noTopics = draft.subjects.filter((s) => !s.topics.length).length;
  const summarizedSubjects = new Set((extraction?.warnings ?? []).filter((w) => w.code === 'topics_summarized').map((w) => w.subject ?? ''));
  // Página onde a matéria começa no edital; sem tópicos lidos, o começo do conteúdo programático (ou a 1ª página).
  const firstPage = (s: DraftSubject) => {
    const ps = s.topics.map((t) => t.page).filter((p) => p > 0);
    return ps.length ? Math.min(...ps) : pages.length ? Math.min(...pages) : 1;
  };

  async function correct() {
    if (!draft) return;
    setBusy(true); setError('');
    try {
      const id = await startCorrection(notice.id, draft);
      await qc.invalidateQueries();
      navigate(`/concursos/${id}/comparar`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function confirm() {
    if (!draft) return;
    setBusy(true); setError('');
    try {
      await approveNotice(notice.id, extraction?.id ?? null, draft);
      await qc.invalidateQueries();
      navigate(notice.replaces_notice_id ? `/concursos/${notice.id}/comparar` : `/concursos/${notice.id}/questionario`);
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
    </>
  );

  return (
    <Shell title="Conferência" subtitle="Confira o que a IA leu do edital. Tudo pode ser corrigido antes de seguir." rail={rail}>
      <Steps current={1} noticeId={notice.id} upTo={notice.status === 'reviewed' ? 2 : 1} />
      <div className="hero" style={{ display: 'grid', gap: 14 }}>
        <label className="field">Nome do plano
          <input className="input" value={draft.title} onChange={(e) => set({ title: e.target.value })} style={{ fontSize: 20, fontWeight: 600 }} />
        </label>
        <div className="row">
          <label className="field">Órgão<input className="input" value={draft.organization} onChange={(e) => set({ organization: e.target.value })} /></label>
          <label className="field">Cargo<input className="input" value={draft.role} onChange={(e) => set({ role: e.target.value })} /></label>
          <label className="field">Escolaridade
            <select className="select" value={draft.educationLevel} onChange={(e) => set({ educationLevel: e.target.value as Draft['educationLevel'] })}>
              <option value="">Não informada</option>
              {EDUCATION_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        </div>
        <div className="row">
          <label className="field">Banca<input className="input" value={draft.board} onChange={(e) => set({ board: e.target.value })} /></label>
          <label className="field">Data da prova<input className="input" type="date" value={draft.examDate} onChange={(e) => set({ examDate: e.target.value })} /></label>
          <label className="field">Questões na prova<input className="input" type="number" min={0} value={draft.totalQuestions} onChange={(e) => set({ totalQuestions: Number(e.target.value) || 0 })} /></label>
        </div>
        <label className="field">Atribuições do cargo
          <textarea className="textarea" rows={3} value={draft.roleDuties} onChange={(e) => set({ roleDuties: e.target.value })} placeholder="Como o edital descreve o cargo escolhido (anexo de atribuições)" />
          <span className="faint small">A IA usa estas atribuições no cronograma e nas apostilas. Confira se são do cargo certo.</span>
        </label>
        {!!draft.structure.otherRoles.length && <p className="faint small" style={{ margin: 0 }}>Outros cargos neste edital: {draft.structure.otherRoles.join(' · ')}</p>}
      </div>

      <div className="section-title"><h2>Matérias</h2><span className="badge violet">{draft.subjects.length}</span></div>
      {/* Cobertura: o que foi lido do conteúdo programático, para o candidato conferir com o edital antes de seguir. */}
      <div className="glass card" style={{ marginBottom: 16, display: 'grid', gap: 8 }}>
        <strong>{topicsCount} tópicos em {draft.subjects.length} matérias{pages.length ? `, lidos das páginas ${Math.min(...pages)} a ${Math.max(...pages)} do edital` : ''}.</strong>
        <span className="muted small">Confira cada matéria com o conteúdo programático do edital. Todos os tópicos daqui entram no cronograma, e depois você acompanha cada um no Edital verticalizado.</span>
        {noTopics > 0 && <div className="warning-card"><AlertTriangle /><span>{noTopics === 1 ? '1 matéria está' : `${noTopics} matérias estão`} sem tópicos. Cole os itens do edital nela{noTopics === 1 ? '' : 's'}, um por linha; sem tópicos, o cronograma usa só o nome da matéria.</span></div>}
      </div>
      <div className="grid">
        {groups.map((g) => (
          <details key={g.name || '-'} className="block-group" open>
            <summary>
              <strong>{g.name || 'Sem bloco'}</strong>
              {g.questions > 0 && <span className="badge cyan">{g.questions} questões no bloco</span>}
              <span className="muted small">{g.items.length} matéria{g.items.length === 1 ? '' : 's'} · {g.items.reduce((n, x) => n + x.s.topics.length, 0)} tópicos</span>
            </summary>
            <div className="grid" style={{ marginTop: 12 }}>
        {g.items.map(({ s, i }) => (
          <div key={i} className="glass subject-edit">
            <div className="subject-edit-head">
              <SubjectIcon name={s.name} index={i} />
              <input className="input" aria-label="Nome da matéria" value={s.name} onChange={(e) => setSubject(i, { name: e.target.value })} />
              {/* Confere a matéria no edital: abre o PDF na página onde os tópicos dela começam. */}
              <button className="btn ghost sm" title="Abrir o edital na página desta matéria" style={{ whiteSpace: 'nowrap' }}
                onClick={() => openNoticePdf(notice.id, firstPage(s)).catch((e: Error) => setError(e.message))}>
                <FileText size={15} /> Ver no PDF{firstPage(s) > 1 ? ` (p. ${firstPage(s)})` : ''}
              </button>
              <button className="icon-btn" title="Remover matéria" aria-label={`Remover ${s.name}`} onClick={() => set({ subjects: draft.subjects.filter((_, j) => j !== i) })}><Trash2 size={17} /></button>
            </div>
            <div className="row">
              <label className="field">Bloco<input className="input" value={s.block} onChange={(e) => setSubject(i, { block: e.target.value })} /></label>
              <label className="field" style={{ flex: '0 1 200px' }}>Peso
                <select className="select" value={s.weight} onChange={(e) => setSubject(i, { weight: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5].map((w) => <option key={w} value={w}>{w}{w === 1 ? ' · pouco cobrada' : w === 5 ? ' · muito cobrada' : ''}</option>)}
                </select>
              </label>
              <label className="check"><input type="checkbox" checked={s.core} onChange={(e) => setSubject(i, { core: e.target.checked })} /> Específica do cargo</label>
            </div>
            <details open={!s.topics.length}>
              <summary className="muted" style={{ cursor: 'pointer' }}>
                {s.topics.length ? `${s.topics.length} tópico(s) do conteúdo programático` : <span className="error">Nenhum tópico lido: cole os itens do edital abaixo, um por linha</span>}
                {summarizedSubjects.has(s.name) && <span className="badge orange" style={{ marginLeft: 8 }}>resumidos pela IA: confira com o PDF</span>}
              </summary>
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
            </div>
          </details>
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
          ? <>
              {/* Edital com cronograma: a correção vira uma versão nova do edital, e o cronograma é refeito aproveitando o que já foi estudado. */}
              <button className="btn" disabled={busy} onClick={correct}><CheckCircle2 size={18} /> {busy ? 'Salvando…' : 'Salvar correções e atualizar o cronograma'}</button>
              <span className="muted small" style={{ flexBasis: '100%' }}>Este edital já tem cronograma. Ao salvar, você vê o que mudou e o cronograma é refeito a partir de hoje, com o que já estudou, as questões e as revisões mantidos.</span>
            </>
          : <button className="btn" disabled={busy} onClick={confirm}><CheckCircle2 size={18} /> {busy ? 'Salvando…' : 'Confirmar e seguir'}</button>}
        {/* Já conferido (voltou para olhar): segue sem gravar de novo. */}
        {notice.status === 'reviewed' && <button className="btn ghost" disabled={busy} onClick={() => navigate(`/concursos/${notice.id}/questionario`)}>Ir para o questionário</button>}
        {error && <span className="error" role="alert">{error}</span>}
      </div>
    </Shell>
  );
}
