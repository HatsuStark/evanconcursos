import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { MaterialNote, NoteColor } from '../lib/materials.ts';

export const NOTE_COLORS: { id: NoteColor; label: string }[] = [{ id: 'yellow', label: 'amarelo' }, { id: 'green', label: 'verde' }, { id: 'pink', label: 'rosa' }];

function NoteItem({ n, focused, onGo, onChange, onDelete }: { n: MaterialNote; focused: boolean; onGo: () => void; onChange: (patch: Partial<Pick<MaterialNote, 'note' | 'color'>>) => void; onDelete: () => void }) {
  const [text, setText] = useState(n.note);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (focused) field.current?.focus(); }, [focused]);
  return (
    <li className={`pdf-note ${n.color}`}>
      <div className="pdf-note-head">
        <button className="btn ghost sm" onClick={onGo}>p. {n.page}</button>
        {n.quote && <span className="muted small pdf-note-quote">{n.quote}</span>}
        <span style={{ flex: 1 }} />
        {NOTE_COLORS.map((c) => <button key={c.id} className={`pdf-swatch ${c.id}`} aria-label={`Trocar para ${c.label}`} aria-pressed={n.color === c.id} onClick={() => onChange({ color: c.id })} />)}
        <button className="icon-btn" aria-label={`Apagar marcação da página ${n.page}`} onClick={onDelete}><Trash2 size={15} /></button>
      </div>
      <textarea ref={field} className="input" rows={2} maxLength={4000} placeholder="Escreva uma anotação…" aria-label={`Anotação da página ${n.page}`} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => { if (text !== n.note) onChange({ note: text }); }} />
    </li>
  );
}

// Lista de marcações e anotações da apostila, abaixo da barra do leitor.
export function PdfNotes({ notes, focusId, onGo, onChange, onDelete }: { notes: MaterialNote[]; focusId: string | null; onGo: (page: number) => void; onChange: (id: string, patch: Partial<Pick<MaterialNote, 'note' | 'color'>>) => void; onDelete: (id: string) => void }) {
  if (!notes.length) return <p className="muted small pdf-notes" style={{ margin: 0 }}>Selecione um texto na página para marcar, anotar ou copiar.</p>;
  return (
    <ul className="pdf-notes">
      {notes.map((n) => <NoteItem key={n.id} n={n} focused={focusId === n.id} onGo={() => onGo(n.page)} onChange={(patch) => onChange(n.id, patch)} onDelete={() => onDelete(n.id)} />)}
    </ul>
  );
}
