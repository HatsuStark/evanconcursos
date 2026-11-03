// Pente-fino da reta final: tudo o que já foi estudado na matéria, para reler rápido. Por sessão concluída, o que
// memorizar e as pegadinhas da apostila, os mnemônicos e gatilhos da revisão curta (se já foi gerada) e as marcações feitas nos PDFs daquele trecho. Sem teoria nova e sem custo de IA.
import { useQuery } from '@tanstack/react-query';
import { Layers } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.ts';

interface PenteItem {
  sessionId: string; title: string; memorizar: string[]; pegadinhas: string[]; hasGuide: boolean;
  mnemonicos?: { alvo: string; mnemonico: string; explicacao: string }[]; gatilhos?: { pista: string; resposta: string }[];
}
interface Mark { quote: string; note: string; color: string }

async function loadPente(taskId: string) {
  const { data, error } = await supabase.functions.invoke('study-guide', { body: { action: 'pente', taskId } });
  if (error) throw new Error('Não foi possível carregar o pente-fino agora.');
  const items = (data?.items ?? []) as PenteItem[];
  const ids = items.map((i) => i.sessionId);
  const marks = new Map<string, Mark[]>();
  if (!ids.length) return { items, marks };
  // Marcações dos PDFs nas páginas que cada sessão usa.
  const { data: maps } = await supabase.from('material_maps').select('material_id, session_id, page_from, page_to').in('session_id', ids);
  const mids = [...new Set((maps ?? []).map((m) => m.material_id as string))];
  const { data: notes } = mids.length ? await supabase.from('material_notes').select('material_id, page, quote, note, color').in('material_id', mids).order('page') : { data: [] };
  for (const m of maps ?? []) {
    const hits = (notes ?? []).filter((n) => n.material_id === m.material_id && n.page >= m.page_from && n.page <= m.page_to && (n.quote || n.note));
    if (hits.length) marks.set(m.session_id, [...(marks.get(m.session_id) ?? []), ...hits.map((n) => ({ quote: n.quote, note: n.note, color: n.color }))]);
  }
  return { items, marks };
}

const MARK_COLOR: Record<string, string> = { yellow: 'var(--lime)', green: 'var(--cyan)', pink: 'var(--magenta)' };

export function PenteFinoPanel({ taskId }: { taskId: string }) {
  const q = useQuery({ queryKey: ['pente', taskId], queryFn: () => loadPente(taskId), staleTime: 5 * 60_000 });
  if (q.isError) return <p className="error">{(q.error as Error).message}</p>;
  if (!q.data) return <div className="spinner" />;
  const { items, marks } = q.data;
  const filled = items.filter((i) => i.memorizar.length || i.pegadinhas.length || i.mnemonicos?.length || i.gatilhos?.length || marks.has(i.sessionId));
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="glass card">
        <h3 style={{ marginTop: 0 }}>Como fazer o pente-fino</h3>
        <ul className="advice" style={{ margin: 0 }}>
          <li>Nada de teoria nova: só o que você já estudou nesta matéria, do mais antigo para o mais recente.</li>
          <li>Leia cada item, tampe e tente repetir. O que não sair de primeira, anote para reler amanhã.</li>
          <li>Feche com os flashcards vencidos e algumas questões dos pontos fracos (aba Questões).</li>
        </ul>
        <Link className="btn ghost sm" style={{ marginTop: 12 }} to="/questoes?aba=flashcards"><Layers size={15} /> Flashcards vencidos</Link>
      </div>
      {!filled.length && <p className="muted">{items.length
        ? 'As sessões estudadas desta matéria ainda não têm apostila nem marcações. Use as questões dos pontos fracos e os flashcards.'
        : 'Nenhuma sessão desta matéria foi concluída ainda. Use as questões dos pontos fracos e os flashcards.'}</p>}
      {filled.map((i) => (
        <section key={i.sessionId} className="glass card">
          <h3 style={{ marginTop: 0 }}>{i.title}</h3>
          {!!i.memorizar.length && <div className="guide-memo"><h4>Para memorizar</h4><ul>{i.memorizar.map((p, k) => <li key={k}>{p}</li>)}</ul></div>}
          {!!i.mnemonicos?.length && <div className="guide-mnemo" style={{ marginTop: 10 }}>{i.mnemonicos.map((m, k) => (
            <div key={k}><span className="faint small">{m.alvo}</span><br /><strong>{m.mnemonico}</strong><p>{m.explicacao}</p></div>
          ))}</div>}
          {!!i.gatilhos?.length && <><h4>Gatilhos de prova</h4><div className="guide-cues">{i.gatilhos.map((x, k) => <div key={k}><span>{x.pista}</span><span>→</span><span>{x.resposta}</span></div>)}</div></>}
          {!!i.pegadinhas.length && <><h4>Pegadinhas</h4><ul className="advice">{i.pegadinhas.map((p, k) => <li key={k}>{p}</li>)}</ul></>}
          {!!marks.get(i.sessionId)?.length && <><h4>Suas marcações</h4><ul className="advice">{marks.get(i.sessionId)!.map((m, k) => (
            <li key={k} style={{ borderLeft: `3px solid ${MARK_COLOR[m.color] ?? 'var(--lime)'}`, paddingLeft: 8 }}>
              {m.quote && <span>{m.quote}</span>}{m.note && <span className="muted small" style={{ display: 'block' }}>{m.note}</span>}
            </li>))}</ul></>}
        </section>
      ))}
    </div>
  );
}
