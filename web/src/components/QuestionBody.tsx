import DOMPurify from 'dompurify';
import { Scissors } from 'lucide-react';
import { optionsOf, sameAnswer, type Question } from '../lib/questions.ts';

// HTML das questões vem de fora: sempre limpo antes de exibir (sem scripts, eventos ou iframes).
export const safe = (html: string) => ({ __html: DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'iframe', 'form', 'input'] }) });

// Enunciado e alternativas com seleção e tachado. Com `gabarito`, mostra certa/errada (questão corrigida).
export function QuestionBody({ q, number, chosen, struck, gabarito, locked, onSelect, onStrike }: {
  q: Question; number: number; chosen: string | null; struck: string[]; gabarito: string | null; locked: boolean;
  onSelect: (letra: string) => void; onStrike: (letra: string) => void;
}) {
  return (
    <>
      <header className="q-meta">
        <strong>Questão {number}</strong>
        {q.assunto && <span className="badge violet">{q.assunto}</span>}
        {q.prova && <span className="muted small">{[q.prova.banca, q.prova.ano, q.prova.orgao, q.prova.cargo].filter(Boolean).join(' · ')}</span>}
      </header>
      {!!q.textos.length && <details className="q-texts"><summary>Texto associado</summary>{q.textos.map((t, i) => <div key={i} dangerouslySetInnerHTML={safe(t)} />)}</details>}
      <div className="q-body" dangerouslySetInnerHTML={safe(q.enunciado)} />
      {q.anexos.map((src) => <img key={src} className="q-img" src={src} alt="Imagem da questão" loading="lazy" referrerPolicy="no-referrer" />)}
      <div className="q-options" role="radiogroup" aria-label="Alternativas">
        {optionsOf(q).map((a) => {
          const isStruck = struck.includes(a.letra);
          const state = gabarito ? (sameAnswer(a.letra, gabarito) ? ' right' : chosen === a.letra ? ' wrong' : ' dim') : chosen === a.letra ? ' picked' : '';
          return (
            <div key={a.letra} className={'q-opt-row' + (isStruck ? ' struck' : '')}>
              <button role="radio" aria-checked={chosen === a.letra} className={'q-opt' + state} disabled={locked || isStruck} onClick={() => onSelect(a.letra)}>
                <b>{a.letra}</b><span className="q-opt-text" dangerouslySetInnerHTML={safe(a.texto)} />
                {a.imagens.map((src) => <img key={src} className="q-img" src={src} alt="" loading="lazy" referrerPolicy="no-referrer" />)}
              </button>
              {!locked && (
                <button className={'q-strike' + (isStruck ? ' on' : '')} onClick={() => onStrike(a.letra)} title={isStruck ? 'Desfazer' : 'Tachar: marcar como errada'} aria-label={isStruck ? `Desfazer tachado da ${a.letra}` : `Tachar a alternativa ${a.letra}`}>
                  <Scissors size={15} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
