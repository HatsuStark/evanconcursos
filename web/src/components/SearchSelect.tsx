import { useId, useState, type KeyboardEvent } from 'react';

// Campo com lista de sugestões. Substitui o <datalist>, que refiltra as opções pelo texto digitado: "Português" escondia
// "Língua Portuguesa", e sem acento não sobrava nada.
export function SearchSelect({ value, options, loading, placeholder, label, onChange, onPick, onBlur }: {
  value: string; options: string[]; loading?: boolean; placeholder?: string; label: string;
  onChange: (text: string) => void; onPick: (option: string) => void; onBlur?: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const list = options.filter((o) => o !== value), show = open && (list.length > 0 || !!loading);
  const pick = (o: string) => { onPick(o); setOpen(false); setActive(-1); };
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); setOpen(true);
      if (list.length) setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % list.length : (a <= 0 ? list.length : a) - 1));
    } else if (e.key === 'Enter' && show && list[active]) { e.preventDefault(); pick(list[active]!); }
  }
  return (
    <div className="search-select">
      <input className="input" role="combobox" aria-label={label} aria-expanded={show} aria-controls={id} aria-autocomplete="list" autoComplete="off" value={value} placeholder={placeholder}
        aria-activedescendant={show && list[active] ? `${id}-${active}` : undefined}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
        onBlur={() => { setOpen(false); onBlur?.(); }} />
      {show && (
        <ul className="search-options" id={id} role="listbox" aria-label={label}>
          {list.map((o, i) => (
            // mouseDown, e não click: o clique tiraria o foco do campo e fecharia a lista antes de escolher.
            <li key={o} id={`${id}-${i}`} role="option" aria-selected={i === active} className={i === active ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); pick(o); }}>{o}</li>
          ))}
          {loading && !list.length && <li className="muted small" aria-disabled>Buscando…</li>}
        </ul>
      )}
    </div>
  );
}
