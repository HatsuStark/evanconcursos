import { useQuery } from '@tanstack/react-query';
import { Play, Timer } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createSimulado } from '../lib/practice.ts';
import { supabase } from '../lib/supabase.ts';

// Montar simulado do concurso (estrutura de blocos e questões do edital): completo ou reduzido, com ou sem tempo.
export function SimuladoStarter({ planId, taskId }: { planId: string; taskId?: string }) {
  const navigate = useNavigate();
  const [size, setSize] = useState<'completo' | 'reduzido'>('completo');
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

  async function start() {
    setBusy(true); setError('');
    try {
      const r = await createSimulado({ kind: 'concurso', planId, taskId, size, timed, minutes: Number(minutes) || undefined });
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
      <div className="segmented" style={{ justifySelf: 'start' }}>
        <button className={size === 'completo' ? 'on' : ''} onClick={() => setSize('completo')}>Prova completa</button>
        <button className={size === 'reduzido' ? 'on' : ''} onClick={() => setSize('reduzido')}>Reduzido (~30 questões)</button>
      </div>
      <div className="row">
        <label className="check"><input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} /> <Timer size={15} /> Com cronômetro</label>
        {timed && <label className="field" style={{ flex: '0 1 200px' }}>Minutos (vazio = 3 por questão)<input className="input" type="number" min={5} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>}
      </div>
      <button className="btn" style={{ justifySelf: 'start' }} disabled={busy} onClick={start}>{busy ? <><span className="spinner" /> Montando o simulado…</> : <><Play size={16} /> Começar simulado</>}</button>
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
    </div>
  );
}
