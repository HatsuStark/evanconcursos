import { Scale, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LAWS } from '../../../shared/legal/registry.ts';
import { supabase } from '../lib/supabase.ts';

// "Ver artigo": abre o texto oficial do artigo citado (ex.: "CPP, art. 622") sem sair da questão.
export function ArticleChips({ refs }: { refs: string[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!refs.length) return null;
  return (
    <div className="article-chips">
      {refs.map((r) => <button key={r} className={'chip-btn' + (open === r ? ' on' : '')} onClick={() => setOpen(open === r ? null : r)}><Scale size={13} /> {r}</button>)}
      {open && <ArticlePeek refText={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ArticlePeek({ refText, onClose }: { refText: string; onClose: () => void }) {
  const [state, setState] = useState<{ text: string; heading: string } | 'loading' | 'missing'>('loading');
  useEffect(() => {
    let alive = true;
    setState('loading');
    const m = /^(.+?),\s*art\.\s*(.+)$/.exec(refText);
    const law = m && LAWS.find((l) => l.short === m[1]!.trim());
    if (!m || !law) { setState('missing'); return; }
    (async () => {
      const { data: norm } = await supabase.from('legal_norms').select('id').eq('urn', law.urn).maybeSingle();
      const { data } = norm ? await supabase.from('legal_articles').select('text, heading').eq('norm_id', norm.id).eq('label', m[2]!.trim()).maybeSingle() : { data: null };
      if (alive) setState(data ? (data as { text: string; heading: string }) : 'missing');
    })();
    return () => { alive = false; };
  }, [refText]);
  return (
    <div className="article-peek">
      <header><strong>{refText}</strong><button className="link-btn" onClick={onClose} aria-label="Fechar"><X size={15} /></button></header>
      {state === 'loading' ? <span className="spinner" /> : state === 'missing' ? <p className="muted small" style={{ margin: 0 }}>Artigo não encontrado na lei seca do app.</p> : (
        <>
          {state.heading && <div className="law-heading" style={{ marginTop: 0 }}>{state.heading.split(' › ').slice(-1)[0]}</div>}
          {state.text.split('\n').map((p, i) => <p key={i}>{p}</p>)}
          <span className="faint small">Texto oficial · normas.leg.br (CC BY 4.0)</span>
        </>
      )}
    </div>
  );
}
