import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Highlighter, Search, StickyNote } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { UnlistedNorm } from '../../../shared/legal/norms.ts';
import type { LawRef } from '../../../shared/legal/refs.ts';
import { LAWS, lawByKey, type LawEntry } from '../../../shared/legal/registry.ts';
import { rangesLabel, saveMark, useLawArticles, useMarks, type Article, type Mark } from '../lib/legal.ts';
import { LawUpload } from './LawUpload.tsx';

const COLORS = ['yellow', 'green', 'pink', 'blue'] as const;

// Leitor de lei seca: os artigos da sessão (ou a lei inteira com busca), com marca-texto e anotações.
// own: normas enviadas pelo estudante; missing: as citadas na sessão que o app não tem (pede o PDF).
export function LawReader({ refs, own = [], missing = [] }: { refs: LawRef[]; own?: LawEntry[]; missing?: UnlistedNorm[] }) {
  const [extra, setExtra] = useState<LawRef | null>(null);
  const all = extra ? [...refs, extra] : refs;
  return (
    <div className="grid" style={{ gap: 18 }}>
      {!refs.length && !missing.length && <div className="glass card muted">Esta sessão não cita lei. Se quiser, abra uma lei abaixo.</div>}
      {missing.map((n) => <LawUpload key={n.key} norm={n} />)}
      {all.map((r, i) => <LawBlock key={`${r.law}-${i}`} lawRef={r} own={own} />)}
      <div className="glass card" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="muted small">Abrir outra lei:</span>
        <select className="select" style={{ maxWidth: 360 }} value="" onChange={(e) => e.target.value && setExtra({ law: e.target.value, ranges: [] })}>
          <option value="">Escolha…</option>
          {[...LAWS, ...own].map((l) => <option key={l.key} value={l.key}>{l.short} · {l.name}</option>)}
        </select>
      </div>
    </div>
  );
}

function LawBlock({ lawRef, own }: { lawRef: LawRef; own: LawEntry[] }) {
  const law = lawByKey(lawRef.law, own) ?? { key: lawRef.law, short: lawRef.law, name: lawRef.law, urn: '', match: /$^/ };
  const q = useLawArticles(lawRef, own);
  const [search, setSearch] = useState('');
  const articles = useMemo(() => {
    const list = q.data?.articles ?? [];
    if (!search.trim()) return lawRef.ranges.length ? list : list.slice(0, 40);
    const s = search.trim().toLowerCase(), byNum = /^\d+/.test(s) ? Number(s.match(/^\d+/)![0]) : null;
    return list.filter((a) => (byNum != null ? a.num === byNum : a.text.toLowerCase().includes(s))).slice(0, 60);
  }, [q.data, search, lawRef.ranges.length]);
  const marks = useMarks(articles.map((a) => a.id));

  return (
    <section className="glass law-block">
      <header className="law-head">
        <div>
          <strong style={{ fontSize: 17 }}>{law.name}</strong>
          <div className="muted small">{law.short} · {rangesLabel(lawRef)}{q.data?.norm.version === 'Original' ? ' · texto original (sem compilação atualizada)' : ''}</div>
        </div>
        {!lawRef.ranges.length && (
          <label className="law-search"><Search size={15} /><input className="input" placeholder="Artigo (ex.: 121) ou palavra" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        )}
      </header>
      {q.isLoading && <div className="muted small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="spinner" /> Carregando o texto oficial… (na primeira vez, pode levar alguns segundos)</div>}
      {q.isError && <p className="error">{(q.error as Error).message}</p>}
      {q.data && !articles.length && <p className="muted">Nenhum artigo encontrado{search ? ' para a busca' : ' nesse intervalo'}.</p>}
      <div className="law-articles">
        {articles.map((a, i) => (
          <ArticleView key={a.id} a={a} showHeading={i === 0 || articles[i - 1]!.heading !== a.heading} mark={marks.data?.find((m) => m.article_id === a.id)} />
        ))}
      </div>
      {!lawRef.ranges.length && !search && (q.data?.articles.length ?? 0) > 40 && <p className="faint small">Mostrando os 40 primeiros artigos. Use a busca para ir a um artigo.</p>}
      {q.data?.norm.owner_id && (
        <footer className="faint small law-credit">Fonte: PDF enviado por você em {new Date(q.data.norm.fetched_at).toLocaleDateString('pt-BR')}. Confira no texto oficial se houver dúvida.</footer>
      )}
      {q.data && !q.data.norm.owner_id && (
        <footer className="faint small law-credit">
          {/ctresb/.test(q.data.norm.license ?? '')
            ? <>Fonte: <a href={q.data.norm.source_url} target="_blank" rel="noopener noreferrer">{/\(normas\.leg\.br\)/.test(q.data.norm.license ?? '') ? 'normas.leg.br' : (q.data.norm.license ?? '').split(', via')[0]} <ExternalLink size={11} /></a>, convertido pelo acervo aberto <a href="https://github.com/ctresb/leis" target="_blank" rel="noopener noreferrer">ctresb/leis <ExternalLink size={11} /></a> (não oficial) · lido em {new Date(q.data.norm.fetched_at).toLocaleDateString('pt-BR')}. Confira no texto oficial se houver dúvida.</>
            : /^Conselho Nacional de Justiça/.test(q.data.norm.license ?? '')
            ? <>Fonte: <a href={q.data.norm.source_url} target="_blank" rel="noopener noreferrer">atos normativos do CNJ <ExternalLink size={11} /></a>, texto compilado · lido em {new Date(q.data.norm.fetched_at).toLocaleDateString('pt-BR')}. Texto para estudo; vale o publicado no Diário da Justiça.</>
            : law.pdf
            ? <>Fonte: <a href={law.page ?? q.data.norm.source_url} target="_blank" rel="noopener noreferrer">texto oficial publicado pelo órgão <ExternalLink size={11} /></a> · lido em {new Date(q.data.norm.fetched_at).toLocaleDateString('pt-BR')}. Texto para estudo; vale o publicado no Diário Oficial.</>
            : <>Fonte: <a href={q.data.norm.source_url} target="_blank" rel="noopener noreferrer">normas.leg.br <ExternalLink size={11} /></a> (Congresso Nacional), licença CC BY 4.0 · atualizado em {new Date(q.data.norm.fetched_at).toLocaleDateString('pt-BR')}.
              Texto para estudo; o oficial é o publicado no Diário Oficial da União.</>}
        </footer>
      )}
    </section>
  );
}

function ArticleView({ a, showHeading, mark }: { a: Article; showHeading: boolean; mark?: Mark }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(mark?.note ?? '');
  const save = async (color: string | null, text = note) => { await saveMark(a.id, color, text); await qc.invalidateQueries({ queryKey: ['marks'] }); };
  const [first, ...rest] = a.text.split('\n');
  return (
    <>
      {showHeading && a.heading && <div className="law-heading">{a.heading.split(' › ').slice(-2).join(' › ')}</div>}
      <article className={'law-article' + (a.revoked ? ' revoked' : '') + (mark ? ` mark-${mark.color}` : '')} id={`art-${a.label}`}>
        <p>{first}</p>
        {rest.map((line, i) => <p key={i} className={/^(§|Parágrafo único)/.test(line) ? 'para' : /^[IVXLC]+\s*-/.test(line) ? 'inciso' : /^[a-z]\)/.test(line) ? 'alinea' : ''}>{line}</p>)}
        {!!a.notes.length && <details className="law-notes"><summary>{a.notes.length} nota(s) de alteração</summary>{a.notes.map((n, i) => <div key={i}>{n}</div>)}</details>}
        <div className="law-tools">
          <Highlighter size={14} />
          {COLORS.map((c) => <button key={c} className={`dot dot-${c}` + (mark?.color === c ? ' on' : '')} aria-label={`Marcar em ${c}`} onClick={() => save(mark?.color === c ? null : c)} />)}
          <button className="link-btn" onClick={() => setEditing(!editing)}><StickyNote size={14} /> {mark?.note ? 'Ver nota' : 'Anotar'}</button>
        </div>
        {editing && (
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            <textarea className="textarea" style={{ minHeight: 70 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Sua anotação sobre este artigo" />
            <div style={{ display: 'flex', gap: 8 }}><button className="btn sm" onClick={async () => { await save(mark?.color ?? (note.trim() ? 'yellow' : null)); setEditing(false); }}>Salvar nota</button></div>
          </div>
        )}
        {mark?.note && !editing && <div className="law-note">{mark.note}</div>}
      </article>
    </>
  );
}
