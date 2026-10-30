import { AlertTriangle, BookOpen, CheckCircle2, Printer, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.ts';

interface GuideContent {
  titulo: string; introducao: string;
  secoes: { titulo: string; texto: string; exemplos: string[] }[];
  legislacao: { ref: string; comentario: string }[];
  pontos_banca: string[]; pegadinhas: string[]; resumo: string[];
  perguntas: { pergunta: string; resposta: string }[];
  depende_legislacao: boolean;
}
interface GuideRow { content: GuideContent; sources: string[]; unlisted_sources: string[]; unverified: string[]; model: string; created_at: string; depth: string }

// Sem "gerar de novo" (economia de créditos): a apostila existente é sempre reaproveitada.
async function fetchGuide(taskId: string, depth: string) {
  const { data, error } = await supabase.functions.invoke('study-guide', { body: { taskId, depth } });
  if (error) {
    let msg = error.message;
    try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* sem JSON */ }
    throw new Error(msg);
  }
  return (data as { guide: GuideRow }).guide;
}

const paragraphs = (t: string) => t.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean);

// Apostila da sessão: completa ou revisão curta, gerada pela IA a partir do edital e da lei seca oficial.
export function GuidePanel({ taskId, hasSession }: { taskId: string; hasSession: boolean }) {
  const [depth, setDepth] = useState<'completa' | 'revisao'>('completa');
  const [guide, setGuide] = useState<GuideRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<number | null>(null);

  async function load() {
    setLoading(true); setError('');
    try { setGuide(await fetchGuide(taskId, depth)); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }
  useEffect(() => { setGuide(null); if (hasSession) void load(); }, [depth, taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hasSession) return <div className="glass card muted">A apostila é gerada para as tarefas de teoria. Nos dias de revisão e reforço, use as questões e a lei seca.</div>;
  const g = guide?.content;
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="guide-bar no-print">
        <div className="segmented">
          <button className={depth === 'completa' ? 'on' : ''} onClick={() => setDepth('completa')}>Completa</button>
          <button className={depth === 'revisao' ? 'on' : ''} onClick={() => setDepth('revisao')}>Revisão curta</button>
        </div>
        {g && <button className="btn ghost sm" onClick={() => window.print()}><Printer size={15} /> Imprimir / PDF</button>}
      </div>
      {loading && <div className="glass card" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="spinner" /> Montando a apostila com base no edital e na lei seca… (até 40 segundos na primeira vez)</div>}
      {error && <div className="glass card"><p className="error" style={{ margin: 0 }}>{error}</p><button className="btn sm" style={{ marginTop: 10 }} onClick={() => load()}>Tentar de novo</button></div>}
      {g && !loading && (
        <article className="glass guide printable">
          <header>
            <span className="badge violet"><BookOpen size={12} /> Apostila · {guide!.depth === 'completa' ? 'completa' : 'revisão curta'}</span>
            <h2>{g.titulo}</h2>
            <p className="lead">{g.introducao}</p>
          </header>
          {(!!guide!.unlisted_sources.length || !!guide!.unverified.length) && (
            <div className="warning-card">
              <AlertTriangle />
              <span>
                {!!guide!.unlisted_sources.length && <>Fonte oficial não integrada ao app: {guide!.unlisted_sources.join(', ')}. Os trechos sobre ela não foram conferidos com o texto da lei; confira. </>}
                {!!guide!.unverified.length && <>Citações não verificadas nas fontes: {guide!.unverified.join(', ')}.</>}
              </span>
            </div>
          )}
          {g.secoes.map((s, i) => (
            <section key={i}>
              <h3>{s.titulo}</h3>
              {paragraphs(s.texto).map((p, j) => <p key={j}>{p}</p>)}
              {!!s.exemplos.length && <div className="guide-examples">{s.exemplos.map((e, j) => <p key={j}><b>Exemplo:</b> {e}</p>)}</div>}
            </section>
          ))}
          {!!g.legislacao.length && (
            <section><h3>Lei seca comentada</h3>
              <ul>{g.legislacao.map((l, i) => <li key={i}><b>{l.ref}:</b> {l.comentario}</li>)}</ul>
            </section>
          )}
          {!!g.pontos_banca.length && <section><h3>O que mais cai</h3><ul>{g.pontos_banca.map((p, i) => <li key={i}>{p}</li>)}</ul></section>}
          {!!g.pegadinhas.length && <section className="guide-traps"><h3>Pegadinhas</h3><ul>{g.pegadinhas.map((p, i) => <li key={i}>{p}</li>)}</ul></section>}
          {!!g.resumo.length && <section><h3>Resumo</h3><ul>{g.resumo.map((p, i) => <li key={i}>{p}</li>)}</ul></section>}
          {!!g.perguntas.length && (
            <section><h3>Perguntas de revisão</h3>
              {g.perguntas.map((q, i) => (
                <div key={i} className="guide-q">
                  <button className="link-btn" onClick={() => setOpen(open === i ? null : i)}>{i + 1}. {q.pergunta}</button>
                  {(open === i) && <p className="guide-a"><CheckCircle2 size={14} /> {q.resposta}</p>}
                  <p className="guide-a print-only">{q.resposta}</p>
                </div>
              ))}
            </section>
          )}
          <footer className="faint small">
            <Sparkles size={12} /> Gerada por IA ({guide!.model}) em {new Date(guide!.created_at).toLocaleDateString('pt-BR')} a partir do conteúdo do edital
            {guide!.sources.length ? ` e do texto oficial da lei (normas.leg.br): ${guide!.sources.length} artigo(s)` : ''}.
            {g.depende_legislacao ? ' Depende de legislação que pode ser alterada: confira se houve mudança após essa data.' : ''} Não substitui a leitura da lei seca.
          </footer>
        </article>
      )}
    </div>
  );
}
