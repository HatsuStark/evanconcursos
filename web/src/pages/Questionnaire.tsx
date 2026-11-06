import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Clock, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { LEVEL_NAMES, type PlanInputs } from '../../../shared/ai/plan.ts';
import { ymd } from '../../../shared/domain/dates.ts';
import { subjectEquivalence } from '../../../shared/domain/notice-diff.ts';
import { isOpenEnded } from '../../../shared/domain/rounds.ts';
import { DEFAULT_HOURS } from '../../../shared/domain/scheduler.ts';
import { LawUpload } from '../components/LawUpload.tsx';
import { Shell } from '../components/Shell.tsx';
import { fmtDate, Steps, SubjectIcon } from '../components/ui.tsx';
import { generatePlan, isNetworkError, resolveNoticeLaws, updatePlanFromNotice, useActivePlan, type GenProgress, type SubjectRow } from '../lib/plans.ts';
import { useOwnLaws } from '../lib/legal.ts';
import { supabase } from '../lib/supabase.ts';
import { unlistedNorms } from '../../../shared/legal/norms.ts';

const DAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

// Questionário: disponibilidade, nível por matéria e perfil. Gera (ou refaz) o cronograma com IA.
export function QuestionnairePage() {
  const { noticeId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const previousId = params.get('de'); // novo edital: atualiza o plano do edital anterior
  const existing = useActivePlan(noticeId);
  const previous = useActivePlan(previousId ?? noticeId);
  const subjects = useQuery({
    queryKey: ['subjects', noticeId],
    queryFn: async () => {
      const { data, error } = await supabase.from('notice_subjects').select('id, name, position, is_core, questions, weight').eq('notice_id', noticeId!).order('position');
      if (error) throw new Error(error.message);
      return data as SubjectRow[];
    },
  });
  // Normas citadas no edital que o app não tem (nem no registro, nem enviadas): o estudante pode enviar o PDF antes de
  // montar o cronograma, para as sessões delas serem medidas e terem lei seca, apostila e questões com o texto.
  const own = useOwnLaws();
  // Antes, o servidor busca sozinho o texto das normas citadas (federais e estaduais); só as que não achar pedem o PDF.
  const lawSearch = useQuery({
    queryKey: ['notice-laws', noticeId],
    staleTime: Infinity, retry: false,
    queryFn: async () => {
      const r = await resolveNoticeLaws(noticeId!);
      if (r.found.length) await qc.invalidateQueries({ queryKey: ['own-laws'] });
      return r;
    },
  });
  const topicText = useQuery({
    queryKey: ['notice-topic-text', noticeId],
    queryFn: async () => {
      const { data, error } = await supabase.from('notice_subjects').select('notice_topics(text)').eq('notice_id', noticeId!);
      if (error) throw new Error(error.message);
      return (data as { notice_topics: { text: string }[] }[]).flatMap((s) => s.notice_topics.map((t) => t.text)).join('\n');
    },
  });
  const missingLaws = topicText.data && own.data && !lawSearch.isLoading ? unlistedNorms(topicText.data, own.data.entries) : [];
  const notice = useQuery({
    queryKey: ['notice-exam-date', noticeId],
    queryFn: async () => {
      const { data, error } = await supabase.from('notices').select('exam_date').eq('id', noticeId!).single();
      if (error) throw new Error(error.message);
      return data as { exam_date: string | null };
    },
  });
  const [inputs, setInputs] = useState<PlanInputs | null>(null);
  const [progress, setProgress] = useState<GenProgress | null>(null);
  const [error, setError] = useState('');

  // Respostas anteriores (ao refazer) ou padrão.
  useEffect(() => {
    if (inputs || !subjects.data || existing.isLoading || previous.isLoading) return;
    const source = existing.data ?? (previousId ? previous.data : null), prev = source?.version?.inputs;
    // No novo edital, o nível de cada matéria vem da matéria equivalente do plano anterior.
    const equivalent = source && !existing.data ? subjectEquivalence(source.subjects, subjects.data) : {};
    const carried = Object.fromEntries(Object.entries(equivalent).map(([from, to]) => [to, prev?.levels[from]]));
    setInputs({
      hours: prev?.hours ?? [...DEFAULT_HOURS], startDate: ymd(new Date()), weeklyReview: prev?.weeklyReview ?? true, profile: prev?.profile ?? '',
      levels: Object.fromEntries(subjects.data.map((s) => [s.id, prev?.levels[s.id] ?? carried[s.id] ?? 1])),
    });
  }, [subjects.data, existing.isLoading, existing.data, previous.isLoading, previous.data, previousId, inputs]);

  if (!inputs || !subjects.data) return <Shell title="Questionário"><div className="spinner" /></Shell>;
  const weekly = inputs.hours.reduce((a, h) => a + h, 0);
  const set = (patch: Partial<PlanInputs>) => setInputs({ ...inputs, ...patch });
  const regenerate = !!existing.data;
  const pastExam = isOpenEnded(notice.data?.exam_date, ymd(new Date()));
  const openEnded = pastExam || (!!previousId && !!notice.data && !notice.data.exam_date);
  const updating = !!previousId && !regenerate;

  async function submit() {
    if (!inputs || !noticeId) return;
    if (!weekly) return setError('Informe horas de estudo em pelo menos um dia.');
    if (regenerate && !confirm('Refazer o cronograma a partir de hoje? Tarefas concluídas e o histórico ficam guardados.')) return;
    setError('');
    // A geração leva cerca de 1 minuto: a tela não apaga, para o celular não suspender a aba e derrubar a conexão.
    let lock: WakeLockSentinel | null = null;
    try { lock = (await navigator.wakeLock?.request('screen')) ?? null; } catch { /* sem permissão: segue sem */ }
    try {
      if (updating) {
        const failed = await updatePlanFromNotice(noticeId, inputs, setProgress);
        await qc.invalidateQueries();
        if (failed) alert(`${failed === 1 ? '1 apostila não foi mapeada' : `${failed} apostilas não foram mapeadas`} para o plano novo. Em Meus materiais, use "Mapear de novo".`);
      } else {
        await generatePlan(noticeId, inputs, setProgress);
        await qc.invalidateQueries();
      }
      navigate('/cronograma');
    } catch (e) {
      const message = (e as Error).message;
      setError(isNetworkError(message) ? 'A conexão com a internet caiu durante a geração. Confira o sinal e toque em "Gerar cronograma com IA" de novo: nada foi perdido.' : message);
      setProgress(null);
    } finally {
      void lock?.release().catch(() => {});
    }
  }

  if (progress) {
    const steps = [
      { key: 'strategy', label: 'Definindo a estratégia e a prioridade de cada matéria' },
      { key: 'sessions', label: `Dividindo o conteúdo em sessões de estudo${progress.step === 'sessions' ? ` (${progress.done} de ${progress.total} matérias)` : ''}` },
      { key: 'saving', label: 'Montando o calendário e salvando' },
      ...(updating ? [{ key: 'materials', label: `Mapeando suas apostilas para o novo plano${progress.step === 'materials' ? ` (${progress.done + 1} de ${progress.total})` : ''}` }] : []),
    ];
    const idx = steps.findIndex((s) => s.key === progress.step);
    return (
      <Shell title="Montando seu cronograma" subtitle="Leva cerca de 1 minuto. Mantenha esta tela aberta.">
        <Steps current={3} />
        <div className="hero" style={{ maxWidth: 720 }}>
          <div className="progress-steps">
            {steps.map((s, i) => <div key={s.key} className={'progress-step' + (i < idx ? ' done' : i === idx ? ' active' : '')}><span className="dot" /> {s.label}</div>)}
          </div>
          {progress.step === 'sessions' && <div className="bar" style={{ marginTop: 20 }}><span style={{ width: `${(progress.done / progress.total) * 100}%`, background: 'var(--cyan)' }} /></div>}
        </div>
      </Shell>
    );
  }

  const rail = (
    <>
      <section>
        <h3>Seu tempo</h3>
        <div className="glass card" style={{ display: 'grid', gap: 4 }}>
          <strong style={{ fontSize: 34, color: 'var(--cyan)' }}>{weekly}h</strong>
          <span className="muted">por semana</span>
        </div>
      </section>
      <section>
        <h3>Como funciona</h3>
        <p className="muted small" style={{ margin: 0, lineHeight: 1.6 }}>
          O tempo de cada matéria sai dos pontos em jogo (questões e peso), do seu nível e da prioridade que a IA dá pelo seu perfil; a IA divide o conteúdo em sessões na ordem de aprendizado, com mais sessões para o que a banca mais cobra. Cada dia tem 2 ou 3 blocos de matérias diferentes, sempre com questões.
          {openEnded
            ? ' Depois da primeira volta pelo conteúdo, o plano segue em rodadas de duas semanas, montadas pelo seu desempenho, respeitando suas horas.'
            : ' Até a prova: simulado diagnóstico na 2ª semana e depois a cada 2 ou 3; reforço dos pontos fracos desde a 3ª semana, ajustado ao seu desempenho a cada 2 semanas; lei seca diária em concurso de legislação; revisão semanal com o caderno de erros; semana leve a cada 5; e reta final com simulado semanal. Com pouco tempo, menos teoria nova e mais questões.'}
        </p>
      </section>
    </>
  );

  return (
    <Shell title="Questionário" subtitle={updating ? 'Confira suas respostas: o novo plano aproveita o que você já estudou.' : regenerate ? 'Ajuste suas respostas para refazer o cronograma a partir de hoje.' : 'Algumas perguntas para montar um plano do seu jeito.'} rail={rail}>
      <Steps current={2} noticeId={noticeId} />
      {openEnded && (
        <div className="warning-card" role="status" style={{ marginBottom: 16 }}>
          <AlertTriangle />
          <span>{pastExam
            ? <><strong>Este edital não está aberto:</strong> a prova foi em {fmtDate(notice.data?.exam_date)}. Seu plano não terá prazo e vai se adaptando ao seu desempenho. O próximo edital pode mudar conteúdo e banca.</>
            : <><strong>Este edital não informa a data da prova.</strong> Seu plano não terá prazo e vai se adaptando ao seu desempenho.</>}</span>
        </div>
      )}
      <div className="glass card" style={{ display: 'grid', gap: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}><Clock size={18} style={{ verticalAlign: -2, color: 'var(--cyan)' }} /> Quantas horas você pode estudar em cada dia?</h2>
        <div className="hours-grid">
          {DAYS.map((d, i) => (
            <label key={d} className="hours-day">
              <span>{d}</span>
              <input className="input" type="number" min={0} max={16} step={0.5} value={inputs.hours[i]}
                onChange={(e) => set({ hours: inputs.hours.map((h, j) => (j === i ? Math.max(0, Math.min(16, Number(e.target.value) || 0)) : h)) })} />
            </label>
          ))}
        </div>
        <div className="row">
          <label className="field" style={{ flex: '0 1 220px' }}>Começar em<input className="input" type="date" value={inputs.startDate} onChange={(e) => set({ startDate: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={inputs.weeklyReview} onChange={(e) => set({ weeklyReview: e.target.checked })} /> Último dia de estudo da semana para revisão e caderno de erros</label>
        </div>
      </div>

      <div className="section-title"><h2>Qual o seu nível em cada matéria?</h2></div>
      <div className="grid" style={{ gap: 12 }}>
        {subjects.data.map((s, i) => (
          <div key={s.id} className="glass level-row">
            <SubjectIcon name={s.name} index={i} />
            <strong>{s.name}</strong>
            <div className="segmented" role="radiogroup" aria-label={`Nível em ${s.name}`}>
              {LEVEL_NAMES.map((l, lv) => (
                <button key={l} type="button" role="radio" aria-checked={inputs.levels[s.id] === lv} className={inputs.levels[s.id] === lv ? 'on' : ''}
                  onClick={() => set({ levels: { ...inputs.levels, [s.id]: lv } })}>{l}</button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {lawSearch.isLoading && (
        <p className="muted small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="spinner" /> Buscando o texto das leis citadas no edital…</p>
      )}
      {!!lawSearch.data?.found.length && (
        <p className="muted small">Texto encontrado para {lawSearch.data.found.join(', ')}: as sessões dessas normas terão lei seca, apostila e questões com os artigos.</p>
      )}
      {missingLaws.length > 0 && (
        <>
          <div className="section-title"><h2>Normas do edital sem texto no app</h2></div>
          <div className="glass card" style={{ display: 'grid', gap: 14 }}>
            <p className="muted small" style={{ margin: 0 }}>Opcional. Se você enviar o PDF oficial destas normas antes de gerar o cronograma, as sessões delas são ajustadas ao tamanho do texto, e a lei seca, a apostila e as questões da IA passam a usar os artigos. O PDF fica só para você. Dá para enviar depois, na aba Lei seca da sessão.</p>
            {missingLaws.map((n) => <LawUpload key={n.key} norm={n} compact />)}
          </div>
        </>
      )}

      <div className="section-title"><h2>Conte um pouco sobre você</h2></div>
      <textarea className="textarea glass" maxLength={1500} value={inputs.profile} onChange={(e) => set({ profile: e.target.value })}
        placeholder="Ex.: trabalho 8h por dia; sou formado em Administração; nunca estudei Direito; já fiz provas da VUNESP; tenho dificuldade em Matemática." />

      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginTop: 24 }}>
        <button className="btn" onClick={submit}><Sparkles size={18} /> {updating ? 'Atualizar meu plano com IA' : regenerate ? 'Refazer cronograma com IA' : 'Gerar cronograma com IA'}</button>
        <button className="btn ghost" onClick={() => navigate(`/concursos/${noticeId}/conferencia`)}>Voltar à conferência</button>
        {error && <span className="error" role="alert">{error}</span>}
      </div>
    </Shell>
  );
}
