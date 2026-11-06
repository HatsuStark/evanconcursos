import { BookOpen, Info, CheckCircle2, Headphones, Landmark, Pause, Play, Printer, SkipBack, SkipForward, Sparkles, Square } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { guideSpeech } from '../../../shared/ai/speech.ts';
import { localVoiceSupported } from '../lib/piper.ts';
import { supabase } from '../lib/supabase.ts';
import { BROWSER_DEFAULT, CADU, RATES, useGuideVoice, voiceSupported } from '../lib/voice.ts';

// Objetivos, esquema, prioridade, quadros, memorizar e questões vêm da guide-v4; apostilas antigas não os têm.
interface GuideContent {
  titulo: string; introducao: string; objetivos?: string[]; esquema?: { topico: string; itens: string[] }[];
  secoes: { titulo: string; prioridade?: 'alta' | 'media' | 'baixa'; texto: string; exemplos: string[]; como_banca_cobra?: string }[];
  quadros?: { titulo: string; colunas: string[]; linhas: string[][] }[];
  legislacao: { ref: string; comentario: string }[];
  memorizar?: string[]; pontos_banca: string[]; pegadinhas: string[]; resumo: string[];
  mnemonicos?: { alvo: string; mnemonico: string; explicacao: string }[];   // revisão curta (review-v1)
  gatilhos?: { pista: string; resposta: string }[];
  questoes?: { enunciado: string; alternativas: string[]; gabarito: string; comentario: string }[];
  perguntas: { pergunta: string; resposta: string }[];
  depende_legislacao: boolean;
  perfil_banca?: { banca: string; questoes: number } | null;
  parcial?: boolean; // ainda sendo escrita: chega em partes (roteiro, seções, quadros e lei, prática)
  pendentes?: number[]; // seções do roteiro ainda sendo escritas
}
interface GuideRow { content: GuideContent; sources: string[]; unlisted_sources: string[]; unverified: string[]; model: string; created_at: string; depth: string }

const POLL_MS = 2500, GIVE_UP_MS = 3 * 60 * 1000; // igual ao da função: depois disso a geração foi interrompida

// Sem "gerar de novo" (economia de créditos): a apostila existente é sempre reaproveitada.
// A geração roda em segundo plano no servidor; aqui só espera. null se a espera foi cancelada.
// A apostila chega em partes (o roteiro em segundos, depois as seções): `onPartial` mostra o que já existe enquanto a espera continua.
async function fetchGuide(taskId: string, depth: string, cancelled: () => boolean, onPartial: (g: GuideRow) => void) {
  const giveUp = Date.now() + GIVE_UP_MS;
  for (let poll = false; !cancelled(); poll = true) {
    const { data, error } = await supabase.functions.invoke('study-guide', { body: { taskId, depth, poll } });
    if (error) {
      let msg = error.message;
      try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* sem JSON */ }
      throw new Error(msg);
    }
    const guide = (data as { guide?: GuideRow }).guide;
    if (guide && !guide.content.parcial) return guide;
    if (guide) onPartial(guide);
    if (Date.now() > giveUp) throw new Error('A apostila está demorando mais que o normal. Tente de novo em instantes.');
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return null;
}

const MAP_COLORS = ['var(--cyan)', 'var(--violet)', 'var(--lime)', 'var(--orange)', 'var(--magenta)'];
const paragraphs = (t: string) => t.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean);

// Apostila da sessão: completa ou revisão curta, gerada pela IA a partir do edital e da lei seca oficial.
export function GuidePanel({ taskId, hasSession, initialDepth = 'completa' }: { taskId: string; hasSession: boolean; initialDepth?: 'completa' | 'revisao' | 'aprofundamento' }) {
  const [depth, setDepth] = useState(initialDepth);
  const [guide, setGuide] = useState<GuideRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [shown, setShown] = useState<Record<number, string>>({}); // questão de fixação → alternativa escolhida

  // Trocar de profundidade ou sair da aba cancela a espera; a apostila continua sendo gerada no servidor.
  const loadId = useRef(0);
  async function load() {
    const id = ++loadId.current, cancelled = () => id !== loadId.current;
    setLoading(true); setError('');
    try {
      const g = await fetchGuide(taskId, depth, cancelled, (partial) => { if (!cancelled()) { setGuide(partial); setLoading(false); } });
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
          <button className={depth === 'aprofundamento' ? 'on' : ''} onClick={() => setDepth('aprofundamento')}>Aprofundamento</button>
        </div>
        {g && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {/* Seções ainda em escrita: o áudio sairia só com os títulos. */}
            {voice.status === 'idle' && !g.pendentes?.length && <button className="btn ghost sm" onClick={voice.play}><Headphones size={15} /> Ouvir</button>}
            <button className="btn ghost sm" onClick={() => window.print()}><Printer size={15} /> Imprimir / PDF</button>
          </div>
        )}
      </div>
      {loading && <div className="glass card" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="spinner" /> Montando a apostila com base no edital e na lei seca… (o começo aparece em alguns segundos; pode sair desta tela, ela continua sendo feita)</div>}
      {error && <div className="glass card"><p className="error" style={{ margin: 0 }}>{error}</p><button className="btn sm" style={{ marginTop: 10 }} onClick={() => load()}>Tentar de novo</button></div>}
      {g && !loading && (
        <article ref={article} className="glass guide printable">
          <header {...reading('intro')}>
            <span className="badge violet"><BookOpen size={12} /> Apostila · {guide!.depth === 'completa' ? 'completa' : guide!.depth === 'aprofundamento' ? 'aprofundamento' : 'revisão curta'}</span>
            <h2>{g.titulo}</h2>
            <p className="lead">{g.introducao}</p>
            {!!g.objetivos?.length && <div className="guide-goals"><strong>Ao final, você vai saber</strong><ul>{g.objetivos.map((o, i) => <li key={i}>{o}</li>)}</ul></div>}
          </header>
          {!!g.esquema?.length && (
            <section {...reading('mapa')}><h3>Mapa mental</h3>
              <div className="mindmap">
                <div className="mm-center">{g.titulo}</div>
                <div className="mm-trunk" />
                <div className="mm-branches">{g.esquema.map((e, i) => (
                  <div key={i} className="mm-branch" style={{ '--c': MAP_COLORS[i % MAP_COLORS.length] } as CSSProperties}>
                    <b>{e.topico}</b><ul>{e.itens.map((x, j) => <li key={j}>{x}</li>)}</ul>
                  </div>
                ))}</div>
              </div>
            </section>
          )}
          {/* Artigos que o app não conseguiu conferir com o texto da lei: um lembrete discreto, sem a lista, para não assustar. */}
          {(!!guide!.unlisted_sources.length || !!guide!.unverified.length) && (
            <p className="faint small" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
              <Info size={14} style={{ flex: 'none' }} aria-hidden="true" /> Confira os artigos citados em fontes oficiais.
            </p>
          )}
          {g.secoes.map((s, i) => (
            <section key={i} {...reading(`s${i}`)}>
              <h3>{s.titulo}{s.prioridade === 'alta' && <span className="badge orange" style={{ marginLeft: 8, verticalAlign: 2 }}>cai muito</span>}</h3>
              {g.pendentes?.includes(i) && !s.texto && <p className="muted small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="spinner" /> Escrevendo esta seção…</p>}
              {paragraphs(s.texto).map((p, j) => <p key={j}>{p}</p>)}
              {!!s.exemplos.length && <div className="guide-examples">{s.exemplos.map((e, j) => <p key={j}><b>Exemplo:</b> {e}</p>)}</div>}
              {s.como_banca_cobra && g.perfil_banca && (
                <aside className="guide-board">
                  <strong><Landmark size={15} /> Como a {g.perfil_banca.banca} cobra</strong>
                  <p>{s.como_banca_cobra}</p>
                </aside>
              )}
            </section>
          ))}
          {!!g.mnemonicos?.length && (
            <section {...reading('mnemonicos')}><h3>Mnemônicos</h3>
              <div className="guide-mnemo">{g.mnemonicos.map((m, i) => (
                <div key={i}><span className="faint small">{m.alvo}</span><br /><strong>{m.mnemonico}</strong><p>{m.explicacao}</p></div>
              ))}</div>
            </section>
          )}
          {!!g.gatilhos?.length && (
            <section {...reading('gatilhos')}><h3>Gatilhos de prova</h3>
              <div className="guide-cues">{g.gatilhos.map((x, i) => <div key={i}><span>{x.pista}</span><span>→</span><span>{x.resposta}</span></div>)}</div>
            </section>
          )}
          {(g.quadros ?? []).filter((q) => q.linhas.length).map((q, i) => (
            <section key={`q${i}`} {...reading(`q${i}`)}><h3>{q.titulo}</h3>
              <div className="guide-table"><table className="sum-table"><thead><tr>{q.colunas.map((c, j) => <th key={j}>{c}</th>)}</tr></thead>
                <tbody>{q.linhas.map((l, j) => <tr key={j}>{l.map((c, k) => (k ? <td key={k}>{c}</td> : <th key={k} scope="row">{c}</th>))}</tr>)}</tbody></table></div>
            </section>
          ))}
          {!!g.legislacao.length && (
            <section {...reading('lei')}><h3>Lei seca comentada</h3>
              <ul>{g.legislacao.map((l, i) => <li key={i}><b>{l.ref}:</b> {l.comentario}</li>)}</ul>
            </section>
          )}
          {g.parcial && <div className="glass card no-print" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="spinner" /> {g.secoes.length ? 'Escrevendo o restante: quadros, lei comentada, o que memorizar, pegadinhas e questões de fixação…' : 'Escrevendo o restante da revisão…'} Pode ir lendo; aparece aqui em instantes.</div>}
          {!!g.memorizar?.length && <section {...reading('memorizar')} className={'guide-memo' + (voice.activeKey === 'memorizar' ? ' speaking' : '')}><h3>Para memorizar</h3><ul>{g.memorizar.map((p, i) => <li key={i}>{p}</li>)}</ul></section>}
          {!!g.pontos_banca.length && <section {...reading('banca')}><h3>O que mais cai</h3><ul>{g.pontos_banca.map((p, i) => <li key={i}>{p}</li>)}</ul></section>}
          {!!g.pegadinhas.length && <section data-voice="pegadinhas" className={'guide-traps' + (voice.activeKey === 'pegadinhas' ? ' speaking' : '')}><h3>Pegadinhas</h3><ul>{g.pegadinhas.map((p, i) => <li key={i}>{p}</li>)}</ul></section>}
          {!!g.resumo.length && <section {...reading('resumo')}><h3>Resumo</h3><ul>{g.resumo.map((p, i) => <li key={i}>{p}</li>)}</ul></section>}
          {!!g.questoes?.length && (
            <section {...reading('questoes')}><h3>Questões de fixação</h3>
              {g.questoes.map((q, i) => {
                const options = q.alternativas.length ? q.alternativas.map((a, j) => ({ letra: String.fromCharCode(65 + j), texto: a })) : [{ letra: 'C', texto: 'Certo' }, { letra: 'E', texto: 'Errado' }];
                const chosen = shown[i], right = q.gabarito.trim().slice(0, 1).toUpperCase();
                return (
                  <div key={i} className="guide-q guide-fix">
                    <p style={{ margin: '0 0 6px' }}><b>{i + 1}.</b> {q.enunciado}</p>
                    <div className="guide-options no-print">
                      {options.map((o) => (
                        <button key={o.letra} className={'guide-option' + (chosen ? (o.letra === right ? ' right' : o.letra === chosen ? ' wrong' : '') : '')} disabled={!!chosen} onClick={() => setShown({ ...shown, [i]: o.letra })}>
                          <b>{o.letra})</b> {o.texto}
                        </button>
                      ))}
                    </div>
                    <ol className="print-only" type="A">{q.alternativas.map((a, j) => <li key={j}>{a}</li>)}</ol>
                    {chosen && <p className="guide-a"><CheckCircle2 size={14} /> Gabarito: {right}{chosen === right ? ' — você acertou.' : '.'} {q.comentario}</p>}
                    <p className="guide-a print-only">Gabarito: {right}. {q.comentario}</p>
                  </div>
                );
              })}
              <p className="faint small" style={{ margin: 0 }}>Questões criadas pela IA para fixar o conteúdo, no formato da banca. As questões reais ficam na aba Questões.</p>
            </section>
          )}
          {!!g.perguntas.length && (
            <section {...reading('perguntas')}><h3>{guide!.depth === 'revisao' ? 'Tente lembrar' : 'Perguntas de revisão'}</h3>
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
            {g.perfil_banca ? ` "Como a ${g.perfil_banca.banca} cobra" vem de uma amostra de ${g.perfil_banca.questoes} ${g.perfil_banca.questoes === 1 ? 'questão real' : 'questões reais'}, não de toda a banca.` : ''}
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
            {localVoiceSupported() && <option value={CADU}>Cadu</option>}
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
          {!voice.isCadu && voiceSupported() && !voice.voices.length && <span className="faint small">Sem voz em português no navegador: a pronúncia pode sair errada.</span>}
          {voice.error && <span className="error small">{voice.error}</span>}
        </div>
      )}
    </div>
  );
}
