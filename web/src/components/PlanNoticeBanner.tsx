import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { useState } from 'react';
import { applySplit, previewSplit, type SplitPreview } from '../lib/plans.ts';
import { supabase } from '../lib/supabase.ts';
import { fmtDate } from './ui.tsx';

interface NoticeItem { subject: string; session: string; sessionId?: string; date: string | null; added: string }
interface PlanNotice { id: string; title: string; items: NoticeItem[]; created_at: string }

// Mudança no cronograma feita pelo app (ex.: artigos do edital que tinham ficado fora e foram incluídos): mostra onde
// mudou até o estudante dispensar. As sessões que ficaram maiores que um dia podem ser divididas em partes, nos dias de
// aprofundamento/consolidação da mesma matéria: primeiro a prévia, depois a confirmação.
export function PlanNoticeBanner({ planId, noticeId }: { planId: string; noticeId: string }) {
  const q = useQuery({
    queryKey: ['plan-notices', planId],
    queryFn: async () => {
      const { data, error } = await supabase.from('plan_notices').select('id, title, items, created_at').eq('plan_id', planId).is('seen_at', null).order('created_at');
      if (error) throw error;
      return (data ?? []) as PlanNotice[];
    },
  });
  if (!q.data?.length) return null;
  return <>{q.data.map((n) => <NoticeCard key={n.id} n={n} planId={planId} noticeId={noticeId} />)}</>;
}

function NoticeCard({ n, planId, noticeId }: { n: PlanNotice; planId: string; noticeId: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<SplitPreview[] | null>(null);
  const splits = preview?.filter((p) => p.parts.length > 1) ?? [];

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label); setError('');
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  const dismiss = () => run('ok', async () => {
    await supabase.from('plan_notices').update({ seen_at: new Date().toISOString() }).eq('id', n.id);
    await qc.invalidateQueries({ queryKey: ['plan-notices', planId] });
  });
  const loadPreview = () => run('preview', async () => setPreview((await previewSplit(noticeId, n.id)).preview));
  const apply = () => run('apply', async () => {
    await applySplit(noticeId, n.id);
    await qc.invalidateQueries();
  });

  return (
    <div className="glass card replan plan-notice">
      <Info size={20} style={{ color: 'var(--accent, var(--orange))', flex: 'none' }} />
      <div style={{ flex: 1, minWidth: 220 }}>
        <strong>{n.title}</strong>
        <ul className="muted small">
          {n.items.map((it, i) => (
            <li key={i}><b>{it.subject}</b>{it.date ? `, ${fmtDate(it.date)}` : ''}: “{it.session}” agora inclui {it.added}.</li>
          ))}
        </ul>
        {preview && (splits.length ? (
          <>
            <p className="small" style={{ margin: '10px 0 0' }}><strong>Reorganização proposta</strong>: cada sessão maior vira partes, uma por dia. Os dias extras saem de aprofundamentos, revisões com questões ou consolidações da mesma matéria; as outras matérias não mudam.</p>
            <ul className="muted small">
              {splits.map((s, i) => (
                <li key={i}><b>{s.subject}</b>: “{s.session}” em {s.parts.length} partes:
                  <ul>{s.parts.map((p, j) => <li key={j}>{fmtDate(p.date)}: {p.title}{p.replaces ? ` (no lugar de “${p.replaces}”)` : ''}</li>)}</ul>
                  {s.missingDays > 0 && <span> Pediria mais {s.missingDays} {s.missingDays === 1 ? 'dia' : 'dias'}, mas não há outro dia livre da matéria depois dela.</span>}
                </li>
              ))}
            </ul>
          </>
        ) : <p className="small" style={{ margin: '10px 0 0' }}>As sessões que mudaram ainda cabem num dia de estudo (ou já foram estudadas, ou não há dia livre da matéria depois delas): não há o que reorganizar.</p>)}
        {error && <p className="error small" style={{ margin: 0 }}>{error}</p>}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {!preview && <button className="btn sm" disabled={!!busy} onClick={loadPreview}>{busy === 'preview' ? <><span className="spinner" /> Calculando…</> : 'Reorganizar os dias'}</button>}
        {!!splits.length && <button className="btn sm" disabled={!!busy} onClick={apply}>{busy === 'apply' ? <><span className="spinner" /> Reorganizando…</> : 'Confirmar'}</button>}
        <button className="btn ghost sm" disabled={!!busy} onClick={dismiss}>{preview && splits.length ? 'Manter como está' : 'Entendi'}</button>
      </div>
    </div>
  );
}
