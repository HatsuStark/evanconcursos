import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { useState } from 'react';
import { supabase } from '../lib/supabase.ts';
import { fmtDate } from './ui.tsx';

interface NoticeItem { subject: string; session: string; date: string | null; added: string }
interface PlanNotice { id: string; title: string; items: NoticeItem[]; created_at: string }

// Mudança no cronograma feita pelo app (ex.: artigos do edital que tinham ficado fora e foram incluídos): mostra onde
// mudou até o estudante dispensar.
export function PlanNoticeBanner({ planId }: { planId: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ['plan-notices', planId],
    queryFn: async () => {
      const { data, error } = await supabase.from('plan_notices').select('id, title, items, created_at').eq('plan_id', planId).is('seen_at', null).order('created_at');
      if (error) throw error;
      return (data ?? []) as PlanNotice[];
    },
  });
  if (!q.data?.length) return null;

  async function dismiss(id: string) {
    setBusy(true);
    try {
      await supabase.from('plan_notices').update({ seen_at: new Date().toISOString() }).eq('id', id);
      await qc.invalidateQueries({ queryKey: ['plan-notices', planId] });
    } finally { setBusy(false); }
  }

  return <>{q.data.map((n) => (
    <div key={n.id} className="glass card replan plan-notice">
      <Info size={20} style={{ color: 'var(--accent, var(--orange))', flex: 'none' }} />
      <div style={{ flex: 1, minWidth: 220 }}>
        <strong>{n.title}</strong>
        <ul className="muted small">
          {n.items.map((it, i) => (
            <li key={i}><b>{it.subject}</b>{it.date ? `, ${fmtDate(it.date)}` : ''}: “{it.session}” agora inclui {it.added}.</li>
          ))}
        </ul>
      </div>
      <button className="btn ghost sm" disabled={busy} onClick={() => dismiss(n.id)}>Entendi</button>
    </div>
  ))}</>;
}
