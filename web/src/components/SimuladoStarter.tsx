import { useQuery } from '@tanstack/react-query';
import { Play, Timer } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createSimulado, simuladoCoverage } from '../lib/practice.ts';
import { supabase } from '../lib/supabase.ts';

// Montar simulado do concurso (estrutura de blocos e questões do edital): completo ou reduzido, com ou sem tempo.
// Enquanto o estudante não viu a maior parte do edital, o padrão é cobrar só o conteúdo estudado: o edital inteiro
// mediria chute, não aprendizado. Ele pode trocar.
export function SimuladoStarter({ planId, taskId }: { planId: string; taskId?: string }) {
  const navigate = useNavigate();
  const [size, setSize] = useState<'completo' | 'reduzido'>('completo');
  const [picked, setPicked] = useState<'estudado' | 'edital' | null>(null);
  const [timed, setTimed] = useState(true);
  const [minutes, setMinutes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Simulado desta tarefa já começado: continua de onde parou.
  const existing = useQuery({
    queryKey: ['task-simulado', taskId],
    enabled: !!taskId,
    queryFn: async () => (await supabase.from('simulados').select('id, status').eq('task_id', taskId!).order('started_at', { ascending: false }).limit(1)).data?.[0] as { id: string; status: string } | undefined,
  });
  const cov = useQuery({ queryKey: ['simulado-coverage', planId], queryFn: () => simuladoCoverage(planId, 'completo'), staleTime: 60_000 });
  const pct = cov.data ? Math.round(cov.data.coverage * 100) : null;
  const nothingStudied = cov.data?.coverage === 0;
  const scope = picked ?? (nothingStudied ? 'edital' : cov.data?.scope ?? 'estudado');

  async function start() {
    setBusy(true); setError('');
    try {
      const r = await createSimulado({ kind: 'concurso', planId, taskId, size, scope, timed, minutes: Number(minutes) || undefined });
      navigate(`/simulados/${r.id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <div className="glass card sim-start">
      <h3 style={{ margin: 0 }}>Simulado do concurso</h3>
      <p className="muted" style={{ margin: 0 }}>Questões da banca na estrutura da prova (blocos e número de questões do edital), sem correção até você entregar. No fim: nota por bloco, aprovação pela nota mínima e revisão com explicações.</p>
      {existing.data && (
        <button className="btn" onClick={() => navigate(`/simulados/${existing.data!.id}`)}>{existing.data.status === 'finished' ? 'Ver resultado do simulado' : 'Continuar simulado'}</button>
      )}
      {pct !== null && (
        <p className="small" style={{ margin: 0 }}>
          Você já estudou <strong>{pct}%</strong> do edital (pelas questões de cada matéria na prova).{' '}
          {cov.data!.scope === 'estudado'
            ? `Até passar de ${Math.round(cov.data!.full * 100)}%, o recomendado é cobrar só o que você já viu: a nota mostra o que você aprendeu, e o conteúdo antigo volta para a memória.`
            : 'Já dá para encarar a prova completa da banca.'}
        </p>
      )}
      <div className="segmented" style={{ justifySelf: 'start' }}>
        <button className={scope === 'estudado' ? 'on' : ''} onClick={() => setPicked('estudado')} disabled={nothingStudied}>Conteúdo estudado</button>
        <button className={scope === 'edital' ? 'on' : ''} onClick={() => setPicked('edital')}>Edital inteiro</button>
      </div>
      {nothingStudied && <p className="muted small" style={{ margin: 0 }}>Conclua algumas sessões de teoria para montar o simulado do conteúdo estudado.</p>}
      <div className="segmented" style={{ justifySelf: 'start' }}>
        <button className={size === 'completo' ? 'on' : ''} onClick={() => setSize('completo')}>{scope === 'estudado' ? 'Parte da prova já estudada' : 'Prova completa'}</button>
        <button className={size === 'reduzido' ? 'on' : ''} onClick={() => setSize('reduzido')}>Reduzido (~30 questões)</button>
      </div>
      <div className="row">
        <label className="check"><input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} /> <Timer size={15} /> Com cronômetro</label>
        {timed && <label className="field" style={{ flex: '0 1 200px' }}>Minutos (vazio = 3 por questão)<input className="input" type="number" min={5} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>}
      </div>
      <button className="btn" style={{ justifySelf: 'start' }} disabled={busy || (scope === 'estudado' && nothingStudied)} onClick={start}>{busy ? <><span className="spinner" /> Montando o simulado…</> : <><Play size={16} /> Começar simulado</>}</button>
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
    </div>
  );
}
