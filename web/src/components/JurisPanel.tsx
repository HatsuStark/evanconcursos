// Jurisprudência da sessão: súmulas e teses oficiais do STF e do STJ ligadas aos artigos do tema. As que mais caem vêm
// primeiro, com uma frase de como a banca cobra (IA); o texto de cada item é sempre o publicado pelo tribunal.
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Flame } from 'lucide-react';
import { useState } from 'react';
import type { JurisItem } from '../../../shared/ai/juris.ts';
import { lawByKey, type LawEntry } from '../../../shared/legal/registry.ts';
import { supabase } from '../lib/supabase.ts';

const SHOW_REST = 8;

async function loadJuris(taskId: string) {
  const { data, error } = await supabase.functions.invoke('jurisprudence', { body: { taskId } });
  if (error) throw new Error('Não foi possível carregar a jurisprudência agora.');
  return data as { items: JurisItem[]; ai?: boolean };
}

const artsLabel = (arts: JurisItem['arts'], own: LawEntry[]) => {
  const byLaw = new Map<string, number[]>();
  for (const a of arts) byLaw.set(a.law, [...(byLaw.get(a.law) ?? []), a.art]);
  return [...byLaw].map(([law, nums]) => `${lawByKey(law, own)?.short ?? law}, art${nums.length > 1 ? 's' : ''}. ${nums.sort((x, y) => x - y).join(', ')}`).join(' · ');
};
const fmt = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR') : '');

export function JurisPanel({ taskId, own = [] }: { taskId: string; own?: LawEntry[] }) {
  const q = useQuery({ queryKey: ['juris', taskId], queryFn: () => loadJuris(taskId), staleTime: 30 * 60_000 });
  const [all, setAll] = useState(false);
  if (q.isError) return <p className="error">{(q.error as Error).message}</p>;
  if (!q.data) return <div className="glass card" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="spinner" /> Buscando súmulas e teses ligadas aos artigos desta sessão…</div>;
  const { items } = q.data;
  if (!items.length) return <div className="glass card muted">Nenhuma súmula ou tese do STF e do STJ ligada aos artigos desta sessão.</div>;
  const hot = items.filter((i) => i.hot), rest = items.filter((i) => !i.hot);
  const shown = all ? rest : rest.slice(0, SHOW_REST);

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="glass card">
        <p style={{ margin: 0 }}>Súmulas e teses do <strong>STF</strong> e do <strong>STJ</strong> sobre os artigos desta sessão, com o texto oficial. Leia junto com a lei seca: a banca cobra a lei como os tribunais a interpretam.</p>
        {hot.length > 0 && <p className="faint small" style={{ margin: '8px 0 0' }}>Os destaques e o "como cai" são uma estimativa da IA sobre o que a banca mais cobra; o enunciado é sempre o do tribunal.</p>}
      </div>
      {hot.length > 0 && <h3 style={{ margin: '4px 0 0', display: 'flex', gap: 8, alignItems: 'center' }}><Flame size={18} /> O que mais cai</h3>}
      {hot.map((i) => <JurisCard key={i.id} item={i} own={own} />)}
      {rest.length > 0 && <h3 style={{ margin: '8px 0 0' }}>{hot.length ? 'Outros ligados a estes artigos' : 'Ligados a estes artigos'}</h3>}
      {shown.map((i) => <JurisCard key={i.id} item={i} own={own} />)}
      {rest.length > shown.length && <button className="btn ghost sm" style={{ justifySelf: 'start' }} onClick={() => setAll(true)}>Mostrar mais {rest.length - shown.length}</button>}
    </div>
  );
}

function JurisCard({ item: i, own }: { item: JurisItem; own: LawEntry[] }) {
  return (
    <section className="glass law-block">
      <header className="law-head">
        <div>
          <strong style={{ fontSize: 16 }}>{i.label}</strong>
          <div className="muted small">{artsLabel(i.arts, own)}{i.decided_on ? ` · julgado em ${fmt(i.decided_on)}` : ''}</div>
        </div>
        <span className={'badge ' + (i.kind === 'sumula_vinculante' ? 'violet' : i.kind === 'repercussao_geral' || i.kind === 'repetitivo' ? 'cyan' : 'lime')}>
          {i.kind === 'sumula_vinculante' ? 'Vinculante' : i.kind === 'repercussao_geral' ? 'Repercussão geral' : i.kind === 'repetitivo' ? 'Repetitivo' : i.kind === 'iac' ? 'IAC' : 'Súmula'}
        </span>
      </header>
      <blockquote className="law-article" style={{ margin: 0 }}><p>{i.text}</p></blockquote>
      {i.how && <p style={{ margin: 0 }}><strong>Como cai:</strong> {i.how}</p>}
      <footer className="faint small law-credit"><a href={i.source_url} target="_blank" rel="noreferrer">Ver no site do {i.court} <ExternalLink size={12} /></a></footer>
    </section>
  );
}
