import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { LEVEL_NAMES, type PlanInputs } from '../../../shared/ai/plan.ts';
import { ymd } from '../../../shared/domain/dates.ts';
import { Shell } from '../components/Shell.tsx';
import { Steps, SubjectIcon } from '../components/ui.tsx';
import { generatePlan, useActivePlan, type GenProgress, type SubjectRow } from '../lib/plans.ts';
import { supabase } from '../lib/supabase.ts';

const DAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

// Questionário: disponibilidade, nível por matéria e perfil. Gera (ou refaz) o cronograma com IA.
export function QuestionnairePage() {
  const { noticeId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const existing = useActivePlan(noticeId);
  const subjects = useQuery({
    queryKey: ['subjects', noticeId],
    queryFn: async () => {
      const { data, error } = await supabase.from('notice_subjects').select('id, name, position, is_core, questions, weight').eq('notice_id', noticeId!).order('position');
      if (error) throw new Error(error.message);
      return data as SubjectRow[];
    },
  });
  const [inputs, setInputs] = useState<PlanInputs | null>(null);
  const [progress, setProgress] = useState<GenProgress | null>(null);
  const [error, setError] = useState('');

  // Respostas anteriores (ao refazer) ou padrão.
  useEffect(() => {
    if (inputs || !subjects.data || existing.isLoading) return;
    const prev = existing.data?.version?.inputs;
    setInputs({
      hours: prev?.hours ?? [2, 2, 2, 2, 2, 4, 0], startDate: ymd(new Date()), weeklyReview: prev?.weeklyReview ?? true, profile: prev?.profile ?? '',
      levels: Object.fromEntries(subjects.data.map((s) => [s.id, prev?.levels[s.id] ?? 1])),
    });
  }, [subjects.data, existing.isLoading, existing.data, inputs]);

  if (!inputs || !subjects.data) return <Shell title="Questionário"><div className="spinner" /></Shell>;
  const weekly = inputs.hours.reduce((a, h) => a + h, 0);
  const set = (patch: Partial<PlanInputs>) => setInputs({ ...inputs, ...patch });
  const regenerate = !!existing.data;

  async function submit() {
    if (!inputs || !noticeId) return;
    if (!weekly) return setError('Informe horas de estudo em pelo menos um dia.');
    if (regenerate && !confirm('Refazer o cronograma a partir de hoje? Tarefas concluídas e o histórico ficam guardados.')) return;
    setError('');
    try {
      await generatePlan(noticeId, inputs, setProgress);
      await qc.invalidateQueries();
      navigate('/cronograma');
    } catch (e) {
      setError((e as Error).message);
      setProgress(null);
    }
  }

  if (progress) {
    const steps = [
      { key: 'strategy', label: 'Definindo a estratégia e a prioridade de cada matéria' },
      { key: 'sessions', label: `Dividindo o conteúdo em sessões de estudo${progress.step === 'sessions' ? ` (${progress.done} de ${progress.total} matérias)` : ''}` },
      { key: 'saving', label: 'Montando o calendário e salvando' },
    ];
    const idx = steps.findIndex((s) => s.key === progress.step);
    return (
      <Shell title="Montando seu cronograma" subtitle="Leva cerca de 1 minuto. Mantenha esta tela aberta.">
        <Steps current={3} />
        <div className="hero" style={{ maxWidth: 720 }}>
          <div className="progress-steps">
            {steps.map((s, i) => <div key={s.key} className={'progress-step' + (i < idx ? ' done' : i === idx ? ' active' : '')}><span className="dot" /> {s.label}</div>)}
          </div>
          {progress.step === 'sessions' && <div className="bar" style={{ marginTop: 20 }}><span style={{ width: `${(progress.done / progress.total) * 100}%`, background: 'var(--cyan)', boxShadow: '0 0 12px var(--cyan)' }} /></div>}
        </div>
      </Shell>
    );
  }

  const rail = (
    <>
      <section>
        <h3>Seu tempo</h3>
        <div className="glass card" style={{ display: 'grid', gap: 4 }}>
          <strong style={{ fontSize: 34, color: 'var(--cyan)', textShadow: '0 0 18px rgba(42,212,232,.5)' }}>{weekly}h</strong>
          <span className="muted">por semana</span>
        </div>
      </section>
      <section>
        <h3>Como funciona</h3>
        <p className="muted small" style={{ margin: 0, lineHeight: 1.6 }}>
          A IA define a prioridade das matérias pelo peso no edital, seu nível e seu perfil, e divide o conteúdo em sessões na ordem de aprendizado.
          O calendário (teoria, consolidação com questões, revisões semanais, simulados e véspera) é montado até a data da prova, respeitando suas horas.
        </p>
      </section>
    </>
  );

  return (
    <Shell title="Questionário" subtitle={regenerate ? 'Ajuste suas respostas para refazer o cronograma a partir de hoje.' : 'Algumas perguntas para montar um plano do seu jeito.'} rail={rail}>
      <Steps current={2} />
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

      <div className="section-title"><h2>Conte um pouco sobre você</h2></div>
      <textarea className="textarea glass" maxLength={1500} value={inputs.profile} onChange={(e) => set({ profile: e.target.value })}
        placeholder="Ex.: trabalho 8h por dia; sou formado em Administração; nunca estudei Direito; já fiz provas da VUNESP; tenho dificuldade em Matemática." />

      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginTop: 24 }}>
        <button className="btn" onClick={submit}><Sparkles size={18} /> {regenerate ? 'Refazer cronograma com IA' : 'Gerar cronograma com IA'}</button>
        {error && <span className="error" role="alert">{error}</span>}
      </div>
    </Shell>
  );
}
