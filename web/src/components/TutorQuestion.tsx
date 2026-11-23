// Uma pergunta da Aula guiada, com ajuda (dica, explicação breve, "Não sei"), correção e o feedback do tutor.
// Serve à aula e à revisão espaçada.
import { ArrowDown, ArrowUp, BookOpen, CheckCircle2, ChevronRight, Flag, ListOrdered, Route, HelpCircle, Lightbulb, MessageCircleQuestion, Repeat, XCircle } from 'lucide-react';
import { Fragment, useMemo, useRef, useState } from 'react';
import { answerOptions, canAskHelp, checkClosed, LETTERS, type WorkedExample, matchesText, shuffledOrder, STAGE_LABEL, type AnswerLog, type TutorConcept, type TutorQuestion } from '../../../shared/domain/tutor.ts';
import { missingMark, splitMarks } from '../../../shared/ai/marks.ts';
import { gradeAnswer, reportTutorQuestion } from '../lib/tutor.ts';
import { ConceptVisuals } from './TutorVisuals.tsx';

// Trecho que o comando chama de "destacado" vem entre **…** e aparece em negrito.
const Marked = ({ text }: { text: string }) => <>{splitMarks(text).map((p, i) => (p.bold ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>))}</>;

const STYLE_LABEL: Record<TutorQuestion['estilo'], string> = { conceito: '', situacao: 'Situação-problema', erro: 'Encontre o erro', comparacao: 'Comparação', aplicacao: 'Aplicação' };
const FORMAT_HINT: Record<TutorQuestion['formato'], string> = {
  multipla: '', certo_errado: 'Julgue a afirmação.', lacuna: 'Complete a lacuna.', curta: 'Responda com suas palavras, em poucas palavras.', ordenacao: 'Coloque na ordem certa.',
};

const CHOICE_HINT: Partial<Record<TutorQuestion['formato'], string>> = {
  lacuna: 'Arraste o balão certo até a lacuna (ou toque nele).', curta: 'Escolha a resposta.',
};

interface Result { correct: boolean; comment?: string; selfCheck?: boolean; response: string }

// `teach`: modo iniciante, o conceito é ensinado num cartão antes da pergunta.
// Lacuna e resposta curta são respondidas sem digitar: na lacuna, arrastando (ou tocando) o balão certo até o espaço; na
// resposta curta, escolhendo numa lista. "Prefiro digitar" volta ao campo de texto. `pool`: as perguntas da aula, de onde
// saem opções erradas quando a pergunta não traz as suas.
// `roadmap`: na primeira situação-problema depois do exemplo resolvido, o roteiro do exemplo (só as perguntas) fica à mão;
// abri-lo conta como ajuda.
export function TutorQuestionCard({ q, concept, subject, lessonKey, taskId, pool, answered, teach, onTaught, roadmap, onAnswer, onNext, onReported, nextLabel = 'Continuar' }: {
  q: TutorQuestion; concept: TutorConcept | undefined; subject: string; lessonKey: string | null; taskId: string | null; pool?: TutorQuestion[];
  answered?: AnswerLog;                 // já respondida (mostra o feedback): retomada depois de recarregar
  teach?: boolean; onTaught?: () => void; roadmap?: string[];
  onAnswer: (log: AnswerLog) => void; onNext: () => void; onReported: () => void; nextLabel?: string;
}) {
  const help = canAskHelp(q.etapa);
  const [hint, setHint] = useState(false);
  const [explained, setExplained] = useState(false);
  const [other, setOther] = useState(false);
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const order0 = useMemo(() => shuffledOrder(q.id, q.alternativas.length), [q.id, q.alternativas.length]);
  const [order, setOrder] = useState(answered && q.formato === 'ordenacao' && answered.response ? answered.response.split(',').map(Number) : order0);
  const [result, setResult] = useState<Result | null>(answered ? { correct: answered.correct, response: answered.response } : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reporting, setReporting] = useState(false);
  const [teaching, setTeaching] = useState(!!teach && !answered && !!concept);
  const textual = q.formato === 'lacuna' || q.formato === 'curta';
  const options = useMemo(() => (textual ? answerOptions(q, pool) : []), [q, pool, textual]);
  const [typing, setTyping] = useState(options.length < 2 || (!!answered?.response && !options.includes(answered.response)));
  const choosing = textual && !typing;
  // Arrastar o balão até a lacuna (mouse e toque). Toque sem arrastar também coloca o balão.
  const blankRef = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ value: string; x0: number; y0: number; moved: boolean } | null>(null);
  const [ghost, setGhost] = useState<{ value: string; x: number; y: number } | null>(null);
  const [over, setOver] = useState(false);
  const overBlank = (x: number, y: number) => {
    const r = blankRef.current?.getBoundingClientRect();
    return !!r && x >= r.left - 24 && x <= r.right + 24 && y >= r.top - 24 && y <= r.bottom + 24;
  };
  const endDrag = () => { drag.current = null; setGhost(null); setOver(false); };

  function finish(r: Result, unknown = false) {
    setResult(r);
    onAnswer({ qid: q.id, conceito: q.conceito, etapa: q.etapa, correct: r.correct, hint, explained, unknown, selfGraded: r.selfCheck, response: r.response.slice(0, 500), at: new Date().toISOString() });
  }

  // Escolha entre opções: a correção é local (a opção certa é a própria resposta esperada).
  function choose(response: string) {
    if (result || busy) return;
    finish({ correct: matchesText(response, q), response });
  }

  async function submit(response: string) {
    if (result || busy) return;
    const closed = checkClosed(q, response);
    if (closed !== null) return finish({ correct: closed, response });
    if (!response.trim()) return;
    if (matchesText(response, q)) return finish({ correct: true, response });
    setBusy(true); setError('');
    try {
      const g = await gradeAnswer(subject, q, response);
      finish({ correct: g.correta, comment: g.comentario, response });
    } catch {
      // Sem a correção automática, o estudante confere com a resposta esperada.
      setResult({ correct: false, selfCheck: true, response });
    } finally { setBusy(false); }
  }

  const move = (i: number, d: -1 | 1) => setOrder((o) => { const n = [...o], j = i + d; if (j < 0 || j >= n.length) return o; [n[i], n[j]] = [n[j]!, n[i]!]; return n; });

  const style = STYLE_LABEL[q.estilo];

  if (teaching && concept) {
    return (
      <div className="glass q-card tutor-q tutor-teach">
        <div className="q-meta"><span className="badge violet">Novo conceito</span><span className="muted small">modo iniciante</span></div>
        <h3><BookOpen size={18} /> {concept.nome}</h3>
        <p>{concept.explicacao}</p>
        <ConceptVisuals concept={concept} />
        {concept.outro_jeito && <div className="tutor-aside"><Lightbulb size={16} /> <span>{concept.outro_jeito}</span></div>}
        {concept.base && <p className="faint small">Base: {concept.base}</p>}
        <p className="faint small">Leia com atenção: em seguida vem uma pergunta para conferir se a ideia ficou clara.</p>
        <div className="tutor-help"><button className="btn" onClick={() => { setTeaching(false); setExplained(true); onTaught?.(); }}>Entendi, ver a pergunta <ChevronRight size={16} /></button></div>
      </div>
    );
  }

  const answerLetter = q.formato === 'multipla' ? q.gabarito : '';
  const expected = q.formato === 'certo_errado' ? (q.gabarito === 'C' ? 'Certo' : 'Errado') : q.formato === 'ordenacao' ? q.alternativas.join(' → ') : q.formato === 'multipla' ? `${q.gabarito}) ${q.alternativas[LETTERS.indexOf(q.gabarito)] ?? ''}` : q.gabarito;
  const wrongWhy = q.formato === 'multipla' && result && !result.correct && result.response ? q.erros[LETTERS.indexOf(result.response)] : '';

  return (
    <div className="glass q-card tutor-q">
      <div className="q-meta">
        <span className="badge violet">{STAGE_LABEL[q.etapa]}</span>
        {style && <span className="badge cyan">{style}</span>}
        {/* O nome do conceito só aparece enquanto ele é ensinado: nas etapas de lembrar, ele entregaria a resposta. */}
        {concept && (q.etapa === 'construcao' || q.etapa === 'reforco') && <span className="muted small">{concept.nome}</span>}
      </div>
      {(choosing ? CHOICE_HINT[q.formato] : FORMAT_HINT[q.formato]) && <div className="faint small">{choosing ? CHOICE_HINT[q.formato] : FORMAT_HINT[q.formato]}</div>}
      <div className="q-body"><p>{choosing && q.formato === 'lacuna'
        ? q.enunciado.split(/_{3,}/).map((t, i) => <Fragment key={i}>{i > 0 && (
          <span ref={i === 1 ? blankRef : undefined} role="button" tabIndex={-1} aria-label={picked ? `Lacuna: ${picked}. Tocar para tirar` : 'Lacuna'}
            className={'tutor-blank' + (picked || result ? ' filled' : '') + (over ? ' over' : '') + (result ? (result.correct ? ' right' : ' wrong') : '')}
            onClick={() => { if (!result) setPicked(null); }}>{(result?.response ?? picked) || '\u00a0'}</span>
        )}<Marked text={t} /></Fragment>)
        : <Marked text={q.enunciado} />}</p></div>

      {roadmap && !result && (
        <details className="tutor-roadmap" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) setHint(true); }}>
          <summary><Route size={15} /> Usar o roteiro do exemplo</summary>
          <ol>{roadmap.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </details>
      )}
      {hint && !result && <div className="tutor-aside"><Lightbulb size={16} /> <span>{q.dica}</span></div>}
      {explained && !result && concept && <div className="tutor-aside"><HelpCircle size={16} /> <span>{concept.explicacao}</span></div>}

      {q.formato === 'multipla' && (
        <div className="q-options">
          {q.alternativas.map((a, i) => {
            const L = LETTERS[i]!, chosen = (result?.response ?? picked) === L;
            const cls = result ? (L === answerLetter ? ' right' : chosen ? ' wrong' : ' dim') : chosen ? ' picked' : '';
            return <button key={L} className={'q-opt' + cls} disabled={!!result || busy} onClick={() => setPicked(L)}><b>{L}</b><p><Marked text={a} /></p></button>;
          })}
          {!result && <button className="btn" disabled={!picked || busy} onClick={() => picked && submit(picked)}>Responder</button>}
        </div>
      )}
      {q.formato === 'certo_errado' && (
        <div className="tutor-ce">
          {(['C', 'E'] as const).map((v) => {
            const chosen = result?.response === v;
            const cls = result ? (v === q.gabarito ? ' right' : chosen ? ' wrong' : ' dim') : '';
            return <button key={v} className={'q-opt' + cls} disabled={!!result} onClick={() => submit(v)}><b>{v}</b><p>{v === 'C' ? 'Certo' : 'Errado'}</p></button>;
          })}
        </div>
      )}
      {choosing && q.formato === 'lacuna' && !result && (
        <div className="tutor-balloons">
          {options.map((o) => (
            <button key={o} type="button" className={'tutor-balloon' + (picked === o ? ' used' : '')}
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { value: o, x0: e.clientX, y0: e.clientY, moved: false }; }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d || (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6)) return;
                d.moved = true; setGhost({ value: d.value, x: e.clientX, y: e.clientY }); setOver(overBlank(e.clientX, e.clientY));
              }}
              onPointerUp={(e) => { const d = drag.current; endDrag(); if (d && (!d.moved || overBlank(e.clientX, e.clientY))) setPicked(d.value); }}
              onPointerCancel={endDrag}
              onClick={(e) => { if (e.detail === 0) setPicked(o); /* teclado */ }}>{o}</button>
          ))}
          {ghost && <span className="tutor-balloon ghost" style={{ left: ghost.x, top: ghost.y }}>{ghost.value}</span>}
          <button className="btn" disabled={!picked} onClick={() => picked && choose(picked)}>Responder</button>
        </div>
      )}
      {choosing && q.formato === 'curta' && (
        <div className="q-options">
          {options.map((o) => {
            const chosen = (result?.response ?? picked) === o;
            const cls = result ? (matchesText(o, q) ? ' right' : chosen ? ' wrong' : ' dim') : chosen ? ' picked' : '';
            return <button key={o} className={'q-opt tutor-short' + cls} disabled={!!result} onClick={() => setPicked(o)}><p>{o}</p></button>;
          })}
          {!result && <button className="btn" disabled={!picked} onClick={() => picked && choose(picked)}>Responder</button>}
        </div>
      )}
      {choosing && !result && <button type="button" className="link-btn faint small" onClick={() => { setTyping(true); setPicked(null); }}>Prefiro digitar</button>}
      {textual && typing && (
        <form className="tutor-text" onSubmit={(e) => { e.preventDefault(); void submit(text); }}>
          <input className="input" value={result ? result.response : text} disabled={!!result || busy} maxLength={300} autoComplete="off"
            placeholder={q.formato === 'lacuna' ? 'Palavra ou expressão que completa' : 'Sua resposta'} onChange={(e) => setText(e.target.value)} aria-label="Sua resposta" />
          {!result && <button className="btn" disabled={!text.trim() || busy}>{busy ? <span className="spinner sm" /> : 'Responder'}</button>}
        </form>
      )}
      {q.formato === 'ordenacao' && (
        <div className="tutor-order">
          {order.map((idx, i) => (
            <div key={idx} className={'tutor-order-item' + (result ? (idx === i ? ' right' : ' wrong') : '')}>
              <b>{i + 1}</b><span>{q.alternativas[idx]}</span>
              {!result && <span className="tutor-order-btns">
                <button className="btn ghost sm" aria-label="Subir" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
                <button className="btn ghost sm" aria-label="Descer" disabled={i === order.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
              </span>}
            </div>
          ))}
          {!result && <button className="btn" onClick={() => submit(order.join(','))}>Confirmar ordem</button>}
        </div>
      )}

      {!result && (
        <div className="tutor-help">
          {help && !hint && q.dica && <button className="btn ghost sm" onClick={() => setHint(true)}><Lightbulb size={15} /> Preciso de uma dica</button>}
          {help && !explained && concept?.explicacao && <button className="btn ghost sm" onClick={() => setExplained(true)}><HelpCircle size={15} /> Explicação breve</button>}
          <button className="btn ghost sm" disabled={busy} onClick={() => finish({ correct: false, response: '' }, true)}><MessageCircleQuestion size={15} /> Não sei</button>
          {!help && <span className="faint small">{q.etapa === 'diagnostico' ? 'Sem problema errar aqui: é para ajustar a aula ao que você já sabe.' : q.etapa === 'desafio' ? 'Nível das questões mais difíceis da banca, sem pistas.' : 'Sem pistas nesta etapa: tente lembrar.'}</span>}
        </div>
      )}
      {error && <p className="error">{error}</p>}

      {result?.selfCheck && !answered && result.comment === undefined && (
        <div className="q-explain">
          <p>Não deu para corrigir automaticamente agora. Compare com a resposta esperada: <b>{expected}</b></p>
          <div className="tutor-help">
            <button className="btn sm" onClick={() => finish({ ...result, correct: true, comment: '', selfCheck: true })}>Acertei</button>
            <button className="btn ghost sm" onClick={() => finish({ ...result, correct: false, comment: '', selfCheck: true })}>Errei</button>
          </div>
        </div>
      )}

      {result && !(result.selfCheck && result.comment === undefined && !answered) && (
        <>
          <div className={'q-result ' + (result.correct ? 'ok' : 'bad')}>
            {result.correct
              ? <><CheckCircle2 size={18} /> {hint || explained ? 'Certo — com ajuda. Ela volta sem pistas mais adiante.' : 'Certo!'}</>
              : <><XCircle size={18} /> {result.response ? 'Não foi dessa vez.' : 'Tudo bem: vamos ver juntos.'}</>}
          </div>
          <section className="q-explain">
            {!result.correct && <p><b>Resposta:</b> {expected}</p>}
            {result.comment && <p>{result.comment}</p>}
            {wrongWhy && <p><b>Por que a {result.response} não serve:</b> {wrongWhy}</p>}
            <p><Marked text={q.explicacao} /></p>
            {!result.correct && concept?.explicacao && concept.explicacao !== q.explicacao && <p className="muted">{concept.explicacao}</p>}
            {!result.correct && concept && <ConceptVisuals concept={concept} />}
            {other && concept?.outro_jeito && <p><b>De outro jeito:</b> {concept.outro_jeito}</p>}
            {concept?.base && <p className="faint small">Base: {concept.base}</p>}
          </section>
          <div className="tutor-help">
            <button className="btn" onClick={onNext}>{nextLabel} <ChevronRight size={16} /></button>
            {!other && concept?.outro_jeito && <button className="btn ghost sm" onClick={() => setOther(true)}><Repeat size={15} /> Explicar de outro jeito</button>}
            <button className="btn ghost sm" onClick={() => setReporting(true)}><Flag size={15} /> Reportar erro</button>
          </div>
        </>
      )}
      {reporting && <ReportForm q={q} lessonKey={lessonKey} taskId={taskId} onClose={() => setReporting(false)} onDone={onReported} />}
    </div>
  );
}

// Exemplo resolvido antes da aplicação: o caso e os passos aparecem um de cada vez (o estudante tenta pensar antes de ver
// a resposta de cada passo), e no fim a conclusão.
export function WorkedExampleCard({ example, concept, onDone }: { example: WorkedExample; concept: TutorConcept | undefined; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const all = step >= example.passos.length;
  return (
    <div className="glass q-card tutor-q tutor-example">
      <div className="q-meta"><span className="badge violet">Exemplo resolvido</span>{concept && <span className="muted small">{concept.nome}</span>}</div>
      <p className="faint small" style={{ margin: 0 }}>Antes das situações-problema, veja como resolver uma. Tente responder cada passo de cabeça antes de abrir.</p>
      <div className="q-body"><p><Marked text={example.caso} /></p></div>
      <ol className="tutor-steps-solved">
        {example.passos.map((s, i) => (
          <li key={i} className={i < step ? 'open' : i === step ? 'next' : 'closed'}>
            <strong>{s.pergunta}</strong>
            {i < step ? <span>{s.resposta}</span> : i === step ? <button className="btn ghost sm" onClick={() => setStep(step + 1)}><ListOrdered size={14} /> Ver este passo</button> : null}
          </li>
        ))}
      </ol>
      {all && <div className="q-explain"><p><b>Conclusão:</b> <Marked text={example.conclusao} /></p><p className="faint small" style={{ margin: 0 }}>Na próxima pergunta, o roteiro fica à mão se precisar.</p></div>}
      <div className="tutor-help">
        {all ? <button className="btn" onClick={onDone}>Ir para as situações-problema <ChevronRight size={16} /></button>
          : <><button className="btn" onClick={() => setStep(example.passos.length)}>Ver tudo</button><button className="btn ghost sm" onClick={onDone}>Pular o exemplo</button></>}
      </div>
    </div>
  );
}

function ReportForm({ q, lessonKey, taskId, onClose, onDone }: { q: TutorQuestion; lessonKey: string | null; taskId: string | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('gabarito');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function send() {
    setBusy(true); setError('');
    try { await reportTutorQuestion({ lessonKey, taskId, question: q, reason, note }); onDone(); } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return (
    <div className="tutor-report">
      <strong>Reportar esta pergunta</strong>
      <select className="select" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Motivo">
        <option value="gabarito">Gabarito errado ou discutível</option>
        <option value="enunciado">Enunciado confuso ou com erro</option>
        <option value="fora">Fora do tema</option>
        <option value="outro">Outro problema</option>
      </select>
      <textarea className="textarea" style={{ minHeight: 70 }} maxLength={1500} placeholder="O que está errado? (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <p className="faint small" style={{ margin: 0 }}>A pergunta sai da sua aula e não conta no seu domínio. Ela vai para revisão.</p>
      {error && <p className="error">{error}</p>}
      <div className="tutor-help">
        <button className="btn sm" disabled={busy} onClick={send}>Enviar</button>
        <button className="btn ghost sm" disabled={busy} onClick={onClose}>Cancelar</button>
      </div>
    </div>
  );
}
