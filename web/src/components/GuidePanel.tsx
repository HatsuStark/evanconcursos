import { BookOpen, GalleryHorizontal, Info, CheckCircle2, Headphones, Landmark, Pause, Play, Printer, SkipBack, SkipForward, Sparkles, Square } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { dropHotDisclaimer } from '../../../shared/ai/hot.ts';
import { missingMark, splitMarks } from '../../../shared/ai/marks.ts';
import { MindMap } from './MindMap.tsx';
import { ReviewCards } from './ReviewCards.tsx';
import { allReviewCards } from '../../../shared/domain/review-cards.ts';
import { guideSpeech } from '../../../shared/ai/speech.ts';
import { planNotes, stillUnverified, type Notes, type RelatedArticle } from '../../../shared/ai/related.ts';
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
// related: lista quando pronto; outro valor (null, em andamento, falhou) = ainda sem os artigos relacionados.
interface GuideRow { content: GuideContent; sources: string[]; unlisted_sources: string[]; unverified: string[]; model: string; created_at: string; depth: string; related?: RelatedArticle[] | unknown }
type Fetched = { guide: GuideRow; relatedPending: boolean };
const relatedOf = (g: GuideRow | null) => (Array.isArray(g?.related) ? (g!.related as RelatedArticle[]) : []);

const POLL_MS = 2500, GIVE_UP_MS = 3 * 60 * 1000; // igual ao da função: depois disso a geração foi interrompida
// Artigos relacionados: uma chamada curta à IA depois da apostila pronta.
const RELATED_POLL_MS = 4000, RELATED_GIVE_UP_MS = 60 * 1000;

// Sem "gerar de novo" (economia de créditos): a apostila existente é sempre reaproveitada.
// A geração roda em segundo plano no servidor; aqui só espera. null se a espera foi cancelada.
// A apostila chega em partes (o roteiro em segundos, depois as seções): `onPartial` mostra o que já existe enquanto a espera continua.
async function fetchGuide(taskId: string, depth: string, cancelled: () => boolean, onPartial: (g: GuideRow) => void, poll = false): Promise<Fetched | null> {
  const giveUp = Date.now() + GIVE_UP_MS;
  for (; !cancelled(); poll = true) {
    const { data, error } = await supabase.functions.invoke('study-guide', { body: { taskId, depth, poll } });
    if (error) {
      let msg = error.message;
      try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* sem JSON */ }
      throw new Error(msg);
    }
    const { guide, relatedPending } = data as { guide?: GuideRow; relatedPending?: boolean };
    if (guide && !guide.content.parcial) return { guide, relatedPending: !!relatedPending };
    if (guide) onPartial(guide);
    if (Date.now() > giveUp) throw new Error('A apostila está demorando mais que o normal. Tente de novo em instantes.');
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return null;
}

// Texto com o resumo de cada artigo citado fora da sessão, entre parênteses logo depois da citação. Tocar no resumo mostra
// o texto oficial ali mesmo.
function Cited({ text, notes }: { text: string; notes: Notes }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!notes.length) return <>{text}</>;
  const out: ReactNode[] = [];
  let last = 0;
  for (const n of notes) {
    out.push(text.slice(last, n.at));
    last = n.at;
    for (const r of n.items) {
      out.push(<span key={r.ref}> <button type="button" className="cite-note" aria-expanded={open === r.ref} title={`${r.ref}: ver o texto oficial`}
        onClick={() => setOpen(open === r.ref ? null : r.ref)}>({n.items.length > 1 ? `${r.ref.replace(/^.*, /, '')}: ` : ''}{r.resumo})</button>
        {open === r.ref && <span className="cite-law">{r.texto}</span>}</span>);
    }
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

const paragraphs = (t: string) => t.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean);

// Trecho que o comando chama de "destacado" vem entre **…** e aparece em negrito.
const Marked = ({ text }: { text: string }) => <>{splitMarks(text).map((p, i) => (p.bold ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>))}</>;
// Apostilas gravadas antes da marca: questão que fala em termo destacado sem nenhum marcado não tem como ser respondida.
const fixQuestions = <Q extends { enunciado: string }>(qs?: Q[]) => (qs ?? []).filter((q) => !missingMark(q.enunciado));

// Apostila da sessão: completa ou revisão curta, gerada pela IA a partir do edital e da lei seca oficial.
export function GuidePanel({ taskId, hasSession, initialDepth = 'completa', onGoQuestions }: { taskId: string; hasSession: boolean; initialDepth?: 'completa' | 'revisao' | 'aprofundamento'; onGoQuestions?: () => void }) {
  const [depth, setDepth] = useState(initialDepth);
  const [sheetView, setSheetView] = useState(false); // revisão curta: folha completa em vez dos cartões
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
      const r = await fetchGuide(taskId, depth, cancelled, (partial) => { if (!cancelled()) { setGuide(partial); setLoading(false); } });
      if (cancelled() || !r) return;
      setGuide(r.guide);
      setLoading(false);
      if (r.relatedPending) void waitRelated(cancelled);
    } catch (e) {
      if (!cancelled()) setError((e as Error).message);
    } finally {
      if (!cancelled()) setLoading(false);
    }
  }
  // A apostila já está na tela; os artigos relacionados entram quando ficam prontos. Falha aqui não incomoda o estudante.
  async function waitRelated(cancelled: () => boolean) {
    const giveUp = Date.now() + RELATED_GIVE_UP_MS;
    while (!cancelled() && Date.now() < giveUp) {
      await new Promise((r) => setTimeout(r, RELATED_POLL_MS));
      if (cancelled()) return;
      const r = await fetchGuide(taskId, depth, cancelled, () => {}, true).catch(() => null);
      if (!r || cancelled()) return;
      if (Array.isArray(r.guide.related) || !r.relatedPending) { setGuide(r.guide); return; }
    }
  }
  useEffect(() => {
    setGuide(null);
    if (hasSession) void load();
    return () => { loadId.current++; };
  }, [depth, taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apostilas antigas trazem na introdução o aviso de estimativa com "leia a lei seca": o aviso agora fica em "O que mais cai".
  const g = useMemo(() => (guide ? { ...guide.content, introducao: dropHotDisclaimer(guide.content.introducao) } : undefined), [guide]);
  // Fontes: artigos ("CP, art. 171"), no nível superior súmulas e teses ("Súmula 17/STJ") e, nas matérias sem lei,
  // trechos de obras abertas ("Guia do Writer 7.1, p. 45").
  const src = guide?.sources ?? [], isJuris = (s: string) => /^(Súmula|Tema|IAC)\b/.test(s);
  const arts = src.filter((s) => /, art\. /.test(s)), juris = src.filter(isJuris), openSrc = src.filter((s) => !/, art\. /.test(s) && !isJuris(s));
  const speech = useMemo(() => (g ? guideSpeech(g) : []), [g]);
  const voice = useGuideVoice(speech);
  // O bloco lido fica destacado e visível.
  const article = useRef<HTMLElement>(null);
  useEffect(() => {
    if (voice.activeKey) article.current?.querySelector(`[data-voice="${voice.activeKey}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [voice.activeKey]);
  // Revisão curta pronta abre em cartões; a folha completa fica a um clique.
  const cardsMode = depth === 'revisao' && guide?.depth === 'revisao' && !!g && !g.parcial && !loading && !sheetView && allReviewCards(g).length > 0;
  const reading = (key: string) => ({ 'data-voice': key, className: voice.activeKey === key ? 'speaking' : undefined });
  // Resumo dos artigos citados fora da sessão, entre parênteses no próprio texto, uma vez por artigo. Os textos vão na
  // ordem da tela (a mesma do JSX abaixo); cada texto com resumo é consumido na primeira vez que aparece.
  const notesPlan = useMemo(() => {
    const rel = relatedOf(guide);
    if (!g || !rel.length) return new Map<string, Notes>();
    const texts = [
      g.introducao, ...g.secoes.flatMap((s) => [...paragraphs(s.texto), ...s.exemplos, ...(s.como_banca_cobra && g.perfil_banca ? [s.como_banca_cobra] : [])]),
      ...g.legislacao.map((l) => l.comentario), ...(g.memorizar ?? []), ...g.pontos_banca, ...g.pegadinhas, ...g.resumo,
    ];
    const byText = new Map<string, Notes>();
    for (const [i, n] of planNotes(texts, rel)) if (!byText.has(texts[i]!)) byText.set(texts[i]!, n);
    return byText;
  }, [g, guide]);
  const pending = new Map(notesPlan);
  const cite = (s: string) => {
    const n = pending.get(s);
    if (!n) return s;
    pending.delete(s);
    return <Cited text={s} notes={n} />;
  };

  if (!hasSession) return <div className="glass card muted">A apostila é gerada para as tarefas de teoria. Nos dias de revisão e reforço, use as questões e a lei seca.</div>;
  return (
    <div className="grid guide-wrap" style={{ gap: 14 }}>
      <div className="guide-bar no-print">
        <div className="segmented">
          <button className={depth === 'completa' ? 'on' : ''} onClick={() => setDepth('completa')}>Completa</button>
          <button className={depth === 'revisao' ? 'on' : ''} onClick={() => setDepth('revisao')}>Revisão curta</button>
          <button className={depth === 'aprofundamento' ? 'on' : ''} onClick={() => setDepth('aprofundamento')}>Aprofundamento</button>
        </div>
        {g && !cardsMode && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {depth === 'revisao' && sheetView && <button className="btn ghost sm" onClick={() => setSheetView(false)}><GalleryHorizontal size={15} /> Revisar em cartões</button>}
            {/* Seções ainda em escrita: o áudio sairia só com os títulos. */}
            {voice.status === 'idle' && !g.pendentes?.length && <button className="btn ghost sm" onClick={voice.play}><Headphones size={15} /> Ouvir</button>}
            <button className="btn ghost sm" onClick={() => window.print()}><Printer size={15} /> Imprimir / PDF</button>
          </div>
        )}
      </div>
      {loading && <div className="glass card" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="spinner" /> Montando a apostila com base no edital e na lei seca… (o começo aparece em alguns segundos; pode sair desta tela, ela continua sendo feita)</div>}
      {error && <div className="glass card"><p className="error" style={{ margin: 0 }}>{error}</p><button className="btn sm" style={{ marginTop: 10 }} onClick={() => load()}>Tentar de novo</button></div>}
      {cardsMode && <ReviewCards taskId={taskId} title={g!.titulo} sheet={g!} onShowSheet={() => setSheetView(true)} onGoQuestions={onGoQuestions} />}
      {g && !loading && !cardsMode && (
        <article ref={article} className="glass guide printable">
          <header {...reading('intro')}>
            <span className="badge violet"><BookOpen size={12} /> Apostila · {guide!.depth === 'completa' ? 'completa' : guide!.depth === 'aprofundamento' ? 'aprofundamento' : 'revisão curta'}</span>
            <h2>{g.titulo}</h2>
            <p className="lead">{cite(g.introducao)}</p>
            {!!g.objetivos?.length && <div className="guide-goals"><strong>Ao final, você vai saber</strong><ul>{g.objetivos.map((o, i) => <li key={i}>{o}</li>)}</ul></div>}
          </header>
          {!!g.esquema?.length && (
            <section {...reading('mapa')}><h3>Mapa mental</h3>
              <MindMap title={g.titulo} branches={g.esquema} />
            </section>
          )}
          {/* Artigos que o app não conseguiu conferir com o texto da lei: um lembrete discreto, sem a lista, para não assustar. */}
          {(!!guide!.unlisted_sources.length || !!stillUnverified(guide!.unverified, relatedOf(guide)).length) && (
            <p className="faint small" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
              <Info size={14} style={{ flex: 'none' }} aria-hidden="true" /> Confira os artigos citados em fontes oficiais.
            </p>
          )}
          {g.secoes.map((s, i) => (
            <section key={i} {...reading(`s${i}`)}>
              <h3>{s.titulo}{s.prioridade === 'alta' && <span className="badge orange" style={{ marginLeft: 8, verticalAlign: 2 }}>cai muito</span>}</h3>
              {g.pendentes?.includes(i) && !s.texto && <p className="muted small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="spinner" /> Escrevendo esta seção…</p>}
              {paragraphs(s.texto).map((p, j) => <p key={j}>{cite(p)}</p>)}
              {!!s.exemplos.length && <div className="guide-examples">{s.exemplos.map((e, j) => <p key={j}><b>Exemplo:</b> {cite(e)}</p>)}</div>}
              {s.como_banca_cobra && g.perfil_banca && (
                <aside className="guide-board">
                  <strong><Landmark size={15} /> Como a {g.perfil_banca.banca} cobra</strong>
                  <p>{cite(s.como_banca_cobra)}</p>
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
              <ul>{g.legislacao.map((l, i) => <li key={i}><b>{l.ref}:</b> {cite(l.comentario)}</li>)}</ul>
            </section>
          )}
          {/* Citados fora dos trechos da sessão: como complementam o tema, com o texto oficial a um clique. */}
          {relatedOf(guide).some((r) => r.confere) && (
            <section className="guide-related"><h3>Artigos relacionados</h3>
              <p className="faint small" style={{ marginTop: -4 }}>Citados nesta apostila, mas fora dos artigos da sessão. Explicação feita por IA a partir do texto oficial.</p>
              <ul>{relatedOf(guide).filter((r) => r.confere).map((r) => (
                <li key={r.ref}><b>{r.ref}:</b> {r.explicacao}
                  <details><summary className="small">Texto oficial</summary><p className="small law-text">{r.texto}</p></details>
                </li>
              ))}</ul>
            </section>
          )}
          {g.parcial && <div className="glass card no-print" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="spinner" /> {g.secoes.length ? 'Escrevendo o restante: quadros, lei comentada, o que memorizar, pegadinhas e questões de fixação…' : 'Escrevendo o restante da revisão…'} Pode ir lendo; aparece aqui em instantes.</div>}
          {!!g.memorizar?.length && <section {...reading('memorizar')} className={'guide-memo' + (voice.activeKey === 'memorizar' ? ' speaking' : '')}><h3>Para memorizar</h3><ul>{g.memorizar.map((p, i) => <li key={i}>{cite(p)}</li>)}</ul></section>}
          {!!g.pontos_banca.length && <section {...reading('banca')}><h3>O que mais cai</h3><p className="faint small" style={{ marginTop: -4 }}>Estimativas feitas por IA.</p><ul>{g.pontos_banca.map((p, i) => <li key={i}>{cite(p)}</li>)}</ul></section>}
          {!!g.pegadinhas.length && <section data-voice="pegadinhas" className={'guide-traps' + (voice.activeKey === 'pegadinhas' ? ' speaking' : '')}><h3>Pegadinhas</h3><ul>{g.pegadinhas.map((p, i) => <li key={i}>{cite(p)}</li>)}</ul></section>}
          {!!g.resumo.length && <section {...reading('resumo')}><h3>Resumo</h3><ul>{g.resumo.map((p, i) => <li key={i}>{cite(p)}</li>)}</ul></section>}
          {!!fixQuestions(g.questoes).length && (
            <section {...reading('questoes')}><h3>Questões de fixação</h3>
              {fixQuestions(g.questoes).map((q, i) => {
                const options = q.alternativas.length ? q.alternativas.map((a, j) => ({ letra: String.fromCharCode(65 + j), texto: a })) : [{ letra: 'C', texto: 'Certo' }, { letra: 'E', texto: 'Errado' }];
                const chosen = shown[i], right = q.gabarito.trim().slice(0, 1).toUpperCase();
                return (
                  <div key={i} className="guide-q guide-fix">
                    <p style={{ margin: '0 0 6px' }}><b>{i + 1}.</b> <Marked text={q.enunciado} /></p>
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
            {arts.length ? ` e do texto oficial da lei (normas.leg.br): ${arts.length} artigo(s)` : ''}
            {juris.length ? `, com ${juris.length} ${juris.length === 1 ? 'súmula ou tese' : 'súmulas e teses'} do STF e do STJ (${juris.join('; ')})` : ''}
            {openSrc.length ? ` e de trechos de obras de licença aberta (${openSrc.join('; ')}; veja a aba Fontes)` : ''}.
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
