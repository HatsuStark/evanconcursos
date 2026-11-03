import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trophy } from 'lucide-react';
import { useState } from 'react';
import { setActiveNotice, useActivePlan } from '../lib/plans.ts';
import { supabase } from '../lib/supabase.ts';

// Concursos com cronograma ativo, para trocar de qualquer tela.
const useContests = () => useQuery({
  queryKey: ['contests'],
  queryFn: async () => {
    const { data: plans, error } = await supabase.from('study_plans').select('notice_id').eq('status', 'active');
    if (error) throw new Error(error.message);
    const ids = (plans ?? []).map((p) => p.notice_id as string);
    if (!ids.length) return [];
    const { data: notices } = await supabase.from('notices').select('id, title, role_name, organization').in('id', ids).order('created_at');
    return (notices ?? []).map((n) => ({ id: n.id as string, name: [n.role_name, n.organization].filter(Boolean).join(' · ') || (n.title as string) }));
  },
});

// Concurso ativo no topo: todos os números da tela são dele. Com mais de um, troca ali mesmo.
export function ContestSwitcher() {
  const qc = useQueryClient();
  const active = useActivePlan();
  const contests = useContests();
  const [busy, setBusy] = useState(false);
  const current = active.data?.notice.id, list = contests.data ?? [];
  if (!current || !list.length) return null;
  const name = list.find((c) => c.id === current)?.name ?? '';
  async function change(id: string) {
    setBusy(true);
    try { await setActiveNotice(id); await qc.invalidateQueries(); } finally { setBusy(false); }
  }
  return (
    <div className="contest-switch" title="Concurso ativo: cronograma, questões, erros, simulados e desempenho são dele">
      <Trophy size={15} aria-hidden />
      {list.length > 1 ? (
        <select className="select" aria-label="Concurso ativo" value={current} disabled={busy} onChange={(e) => void change(e.target.value)}>
          {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      ) : <span>{name}</span>}
      {busy && <span className="spinner" />}
    </div>
  );
}
