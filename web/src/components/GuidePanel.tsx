import { AlertTriangle, BookOpen, CheckCircle2, Headphones, Pause, Play, Printer, SkipBack, SkipForward, Sparkles, Square } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { guideSpeech } from '../../../shared/ai/speech.ts';
import { localVoiceSupported } from '../lib/piper.ts';
import { supabase } from '../lib/supabase.ts';
import { BROWSER_DEFAULT, FABER, RATES, useGuideVoice, voiceSupported } from '../lib/voice.ts';

interface GuideContent {
  titulo: string; introducao: string;
  secoes: { titulo: string; texto: string; exemplos: string[] }[];
  legislacao: { ref: string; comentario: string }[];
  pontos_banca: string[]; pegadinhas: string[]; resumo: string[];
  perguntas: { pergunta: string; resposta: string }[];
  depende_legislacao: boolean;
}
interface GuideRow { content: GuideContent; sources: string[]; unlisted_sources: string[]; unverified: string[]; model: string; created_at: string; depth: string }

const POLL_MS = 4000, GIVE_UP_MS = 3 * 60 * 1000; // igual ao da função: depois disso a geração foi interrompida

// Sem "gerar de novo" (economia de créditos): a apostila existente é sempre reaproveitada.
// A geração roda em segundo plano no servidor; aqui só espera. null se a espera foi cancelada.
async function fetchGuide(taskId: string, depth: string, cancelled: () => boolean) {
  const giveUp = Date.now() + GIVE_UP_MS;
  for (let poll = false; !cancelled(); poll = true) {
    const { data, error } = await supabase.functions.invoke('study-guide', { body: { taskId, depth, poll } });
    if (error) {
      let msg = error.message;
      try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* sem JSON */ }
      throw new Error(msg);
    }
    const guide = (data as { guide?: GuideRow }).guide;
    if (guide) return guide;
    if (Date.now() > giveUp) throw new Error('A apostila está demorando mais que o normal. Tente de novo em instantes.');
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return null;
}

const paragraphs = (t: string) => t.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean);

// Apostila da sessão: completa ou revisão curta, gerada pela IA a partir do edital e da lei seca oficial.
export function GuidePanel({ taskId, hasSession }: { taskId: string; hasSession: boolean }) {
  const [depth, setDepth] = useState<'completa' | 'revisao'>('completa');
  const [guide, setGuide] = useState<GuideRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<number | null>(null);

  // Trocar de profundidade ou sair da aba cancela a espera; a apostila continua sendo gerada no servidor.
  const loadId = useRef(0);
  async function load() {
    const id = ++loadId.current, cancelled = () => id !== loadId.current;
    setLoading(true); setError('');
    try {
      const g = await fetchGuide(taskId, depth, cancelled);
      if (!cancelled()) setGuide(g);
    } catch (e) {
      if (!cancelled()) setError((e as Error).message);
    } finally {
      if (!cancelled()) setLoading(false);
    }
  }
  useEffect(() => {
    setGuide(null);
    if (hasSession) void load();
    return () => { loadId.current++; };
  }, [depth, taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  const g = guide?.content;
  const speech = useMemo(() => (g ? guideSpeech(g) : []), [g]);
  const voice = useGuideVoice(speech);
  // O bloco lido fica destacado e visível.
  const article = useRef<HTMLElement>(null);
  useEffect(() => {
    if (voice.activeKey) article.current?.querySelector(`[data-voice="${voice.activeKey}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [voice.activeKey]);
  const reading = (key: string) => ({ 'data-voice': key, className: voice.activeKey === key ? 'speaking' : undefined });

  if (!hasSession) return <div className="glass card muted">A apostila é gerada para as tarefas de teoria. Nos dias de revisão e reforço, use as questões e a lei seca.</div>;
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="guide-bar no-print">
        <div className="segmented">
          <button className={depth === 'completa' ? 'on' : ''} onClick={() => setDepth('completa')}>Completa</button>
          <button className={depth === 'revisao' ? 'on' : ''} onClick={() => setDepth('revisao')}>Revisão curta</button>
        </div>
        {g && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {voice.status === 'idle' && <button className="btn ghost sm" onClick={voice.play}><Headphones size={15} /> Ouvir</button>}
            <button className="btn ghost sm" onClick={() => window.print()}><Printer size={15} /> Imprimir / PDF</button>
          </div>
        )}
      </div>
      {loading && <div className="glass card" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="spinner" /> Montando a apostila com base no edital e na lei seca… (até 40 segundos na primeira vez; pode sair desta tela, ela continua sendo feita)</div>}
      {error && <div className="glass card"><p className="error" style={{ margin: 0 }}>{error}</p><button className="btn sm" style={{ marginTop: 10 }} onClick={() => load()}>Tentar de novo</button></div>}
      {g && !loading && (
        <article ref={article} className="glass guide printable">
          <header {...reading('intro')}>
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
            <section key={i} {...reading(`s${i}`)}>
              <h3>{s.titulo}</h3>
              {paragraphs(s.texto).map((p, j) => <p key={j}>{p}</p>)}
              {!!s.exemplos.length && <div className="guide-examples">{s.exemplos.map((e, j) => <p key={j}><b>Exemplo:</b> {e}</p>)}</div>}
            </section>
          ))}
          {!!g.legislacao.length && (
            <section {...reading('lei')}><h3>Lei seca comentada</h3>
              <ul>{g.legislacao.map((l, i) => <li key={i}><b>{l.ref}:</b> {l.comentario}</li>)}</ul>
            </section>
          )}
          {!!g.pontos_banca.length && <section {...reading('banca')}><h3>O que mais cai</h3><ul>{g.pontos_banca.map((p, i) => <li key={i}>{p}</li>)}</ul></section>}
          {!!g.pegadinhas.length && <section data-voice="pegadinhas" className={'guide-traps' + (voice.activeKey === 'pegadinhas' ? ' speaking' : '')}><h3>Pegadinhas</h3><ul>{g.pegadinhas.map((p, i) => <li key={i}>{p}</li>)}</ul></section>}
          {!!g.resumo.length && <section {...reading('resumo')}><h3>Resumo</h3><ul>{g.resumo.map((p, i) => <li key={i}>{p}</li>)}</ul></section>}
          {!!g.perguntas.length && (
            <section {...reading('perguntas')}><h3>Perguntas de revisão</h3>
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
      {g && !loading && voice.status !== 'idle' && (
        <div className="glass voice-bar no-print" role="group" aria-label="Leitor por voz">
          <button className="icon-btn" aria-label="Seção anterior" title="Seção anterior" disabled={voice.section === 0} onClick={() => voice.jump(-1)}><SkipBack size={16} /></button>
          {voice.status === 'playing'
            ? <button className="btn sm" onClick={voice.pause}><Pause size={15} /> Pausar</button>
            : <button className="btn sm" onClick={voice.play}><Play size={15} /> Continuar</button>}
          <button className="icon-btn" aria-label="Próxima seção" title="Próxima seção" disabled={voice.section >= speech.length - 1} onClick={() => voice.jump(1)}><SkipForward size={16} /></button>
          <button className="icon-btn" aria-label="Parar" title="Parar" onClick={voice.stop}><Square size={15} /></button>
          <span className="voice-title small">{speech[voice.section]?.title}</span>
          <select className="select voice-select" aria-label="Velocidade" value={voice.rate} onChange={(e) => voice.setRate(Number(e.target.value))}>
            {RATES.map((r) => <option key={r} value={r}>{String(r).replace('.', ',')}x</option>)}
          </select>
          <select className="select voice-select" aria-label="Voz" value={voice.value} onChange={(e) => voice.setVoice(e.target.value)}>
            {localVoiceSupported() && <option value={FABER}>Faber</option>}
            {voiceSupported() && (
              <optgroup label="Voz do navegador">
                {voice.voices.length ? voice.voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>) : <option value={BROWSER_DEFAULT}>Padrão do navegador</option>}
              </optgroup>
            )}
          </select>
          {voice.loading && (
            <span className="faint small" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <span className="spinner" /> {voice.download != null ? `Baixando a voz, só na primeira vez (63 MB): ${Math.round(voice.download * 100)}%` : 'Preparando o áudio…'}
            </span>
          )}
          {!voice.isFaber && voiceSupported() && !voice.voices.length && <span className="faint small">Sem voz em português no navegador: a pronúncia pode sair errada.</span>}
          {voice.error && <span className="error small">{voice.error}</span>}
        </div>
      )}
    </div>
  );
}
