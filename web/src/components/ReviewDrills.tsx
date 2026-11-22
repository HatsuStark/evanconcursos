import { CheckCircle2, ChevronRight, XCircle } from 'lucide-react';
import { useState } from 'react';
import type { TrueFalseItem } from '../../../shared/ai/true-false.ts';
import type { SchemeBranch, SchemeCard } from '../../../shared/domain/weekly-review.ts';
import { MindMap } from './MindMap.tsx';

// Exercícios da revisão da semana depois dos cartões do tema, só por toque. `next`: o passo seguinte da sessão.
type Next = { label: string; onClick: () => void };

function Done({ right, total, label, next, children }: { right: number; total: number; label: string; next: Next; children?: React.ReactNode }) {
  return (
    <div className="glass card grid" style={{ gap: 12 }}>
      <span className="rc-tag rc-cue" style={{ justifySelf: 'start' }}>{label}</span>
      <div className="rc-score">{right}/{total}</div>
      {children}
      <button className="btn" style={{ justifySelf: 'start' }} onClick={next.onClick}>{next.label} <ChevronRight size={16} /></button>
    </div>
  );
}

// Certo ou errado: uma assertiva por vez; tocar mostra se acertou e o porquê.
export function TrueFalseDrill({ items, next }: { items: TrueFalseItem[]; next: Next }) {
  const [i, setI] = useState(0);
  const [chosen, setChosen] = useState<boolean | null>(null);
  const [right, setRight] = useState(0);
  if (i >= items.length) return <Done right={right} total={items.length} label="Certo ou errado" next={next} />;
  const it = items[i]!, answered = chosen !== null, ok = chosen === it.certo;
  const pick = (v: boolean) => { if (answered) return; setChosen(v); if (v === it.certo) setRight(right + 1); };
  return (
    <div className="glass card grid" style={{ gap: 12 }}>
      <div className="daily-review-head">
        <span className="rc-tag rc-trap">Certo ou errado?</span>
        <span className="faint small" style={{ marginLeft: 'auto' }}>{i + 1} de {items.length}</span>
      </div>
      <p style={{ margin: 0, fontSize: 17, lineHeight: 1.5 }}>{it.afirmacao}</p>
      <div className="daily-review-head">
        {[true, false].map((v) => (
          <button key={String(v)} className={'btn' + (answered ? (v === it.certo ? '' : ' ghost') : ' ghost')} disabled={answered} onClick={() => pick(v)}
            style={answered && v === it.certo ? { background: 'var(--lime)', color: 'var(--bg)' } : undefined}>{v ? 'Certo' : 'Errado'}</button>
        ))}
      </div>
      {answered && (
        <>
          <p style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            {ok ? <CheckCircle2 size={18} style={{ color: 'var(--lime)', flex: 'none' }} /> : <XCircle size={18} style={{ color: 'var(--orange)', flex: 'none' }} />}
            <span><strong>{ok ? 'Acertou.' : `Gabarito: ${it.certo ? 'certo' : 'errado'}.`}</strong> {it.explicacao}</span>
          </p>
          <button className="btn sm" style={{ justifySelf: 'start' }} onClick={() => { setI(i + 1); setChosen(null); }}>{i + 1 < items.length ? 'Próxima' : 'Ver resultado'}</button>
        </>
      )}
    </div>
  );
}

// Monte o esquema: cada item do mapa mental vai para o ramo certo. No fim, o mapa inteiro para rever.
// `branches`: já limpos por schemeBranches (os índices do baralho apontam para eles).
export function SchemeSort({ title, branches, deck, next }: { title: string; branches: SchemeBranch[]; deck: SchemeCard[]; next: Next }) {
  const [i, setI] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [right, setRight] = useState(0);
  const names = branches.map((b) => b.topico);
  if (i >= deck.length) return <Done right={right} total={deck.length} label="Esquema montado" next={next}><MindMap title={title} branches={branches} /></Done>;
  const c = deck[i]!, answered = chosen !== null;
  const pick = (j: number) => { if (answered) return; setChosen(j); if (j === c.branch) setRight(right + 1); };
  return (
    <div className="glass card grid" style={{ gap: 12 }}>
      <div className="daily-review-head">
        <span className="rc-tag rc-memo">Monte o esquema</span>
        <span className="faint small" style={{ marginLeft: 'auto' }}>{i + 1} de {deck.length}</span>
      </div>
      <p className="muted small" style={{ margin: 0 }}>Em qual ramo do tema "{title}" entra este item?</p>
      <p style={{ margin: 0, fontSize: 17, lineHeight: 1.5 }}><strong>{c.item}</strong></p>
      <div className="grid" style={{ gap: 8 }}>
        {names.map((n, j) => (
          <button key={j} className={'btn' + (answered && j === c.branch ? '' : ' ghost')} disabled={answered} onClick={() => pick(j)} style={{ justifyContent: 'flex-start', textAlign: 'left',
            ...(answered && j === c.branch ? { background: 'var(--lime)', color: 'var(--bg)' } : answered && j === chosen ? { borderColor: 'var(--orange)', color: 'var(--orange)' } : {}) }}>{n}</button>
        ))}
      </div>
      {answered && <button className="btn sm" style={{ justifySelf: 'start' }} onClick={() => { setI(i + 1); setChosen(null); }}>{i + 1 < deck.length ? 'Próximo item' : 'Ver o esquema'}</button>}
    </div>
  );
}
