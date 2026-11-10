// Fontes da sessão nas matérias sem lei: trechos de obras com licença aberta que explicam o tema (texto literal, com
// página e crédito) e livros de referência para aprofundar (só a indicação, sem trecho: são obras protegidas).
import { useQuery } from '@tanstack/react-query';
import { BookOpen, ExternalLink } from 'lucide-react';
import type { BookRef, SourceItem, SourceMeta } from '../../../shared/ai/sources.ts';
import { supabase } from '../lib/supabase.ts';

async function loadSources(taskId: string) {
  const { data, error } = await supabase.functions.invoke('sources', { body: { taskId } });
  if (error) throw new Error('Não foi possível carregar as fontes agora.');
  return data as { items: SourceItem[]; sources: SourceMeta[]; books: BookRef[]; ai: boolean };
}

export function SourcesPanel({ taskId }: { taskId: string }) {
  const q = useQuery({ queryKey: ['sources', taskId], queryFn: () => loadSources(taskId), staleTime: 30 * 60_000 });
  if (q.isError) return <p className="error">{(q.error as Error).message}</p>;
  if (!q.data) return <div className="glass card" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="spinner" /> Procurando fontes abertas e livros de referência para este tema…</div>;
  const { items, sources, books } = q.data;
  const meta = (key: string) => sources.find((s) => s.key === key);

  return (
    <div className="grid" style={{ gap: 14 }}>
      {!items.length && !books.length && <div className="glass card muted">Ainda não há fonte aberta nem livro de referência para este tema. Use a apostila, os vídeos e as questões.</div>}
      {items.length > 0 && (
        <div className="glass card">
          <p style={{ margin: 0 }}>Trechos de livros e guias de <strong>licença aberta</strong> que explicam o tema, como foram publicados pelos autores. Leia junto com a apostila.</p>
          {q.data.ai && <p className="faint small" style={{ margin: '8px 0 0' }}>A escolha dos trechos e a frase do que cada um explica são da IA; o texto é o original da obra.</p>}
        </div>
      )}
      {items.map((i) => {
        const s = meta(i.source_key);
        return (
          <section key={i.id} className="glass law-block">
            <header className="law-head">
              <div>
                <strong style={{ fontSize: 16 }}>{i.heading || s?.title}</strong>
                <div className="muted small">{i.ref}</div>
              </div>
            </header>
            {i.why && <p style={{ margin: 0 }}><strong>Explica:</strong> {i.why}</p>}
            <blockquote className="law-article" style={{ margin: 0 }}><p style={{ whiteSpace: 'pre-line' }}>{i.text}</p></blockquote>
            {s?.note && <p className="warning-card small" style={{ margin: 0 }}>{s.note}</p>}
            {s && (
              <footer className="faint small law-credit">
                {s.title} — {s.authors}. <a href={s.license_url} target="_blank" rel="noreferrer">{s.license}</a> · <a href={s.url} target="_blank" rel="noreferrer">Obra completa <ExternalLink size={12} /></a>
              </footer>
            )}
          </section>
        );
      })}
      {books.length > 0 && (
        <section className="glass card">
          <h3 style={{ marginTop: 0, display: 'flex', gap: 8, alignItems: 'center' }}><BookOpen size={18} /> Para aprofundar: livros de referência</h3>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8 }}>
            {books.map((b) => (
              <li key={b.title + b.year}>
                <strong>{b.title}</strong> — {b.authors.join(', ')}{b.publisher ? `, ${b.publisher}` : ''}{b.year ? `, ${b.year}` : ''}.
                {b.why && <span className="muted"> {b.why}</span>}
                {b.link && <> <a href={b.link} target="_blank" rel="noreferrer" className="small">Ver no Google Books <ExternalLink size={12} /></a></>}
              </li>
            ))}
          </ul>
          <p className="faint small" style={{ margin: '10px 0 0' }}>Indicações da IA conferidas no Google Books. São obras protegidas por direito autoral: o app não reproduz trechos delas.</p>
        </section>
      )}
    </div>
  );
}
