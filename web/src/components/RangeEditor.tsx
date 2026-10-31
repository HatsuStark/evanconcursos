import { useState } from 'react';

// Campos "Da página X até Y", usados para corrigir e para acrescentar um trecho de apostila.
export function RangeEditor({ from, to, max, onSave, onCancel }: { from?: number; to?: number; max?: number; onSave: (from: number, to: number) => Promise<void>; onCancel: () => void }) {
  const [a, setA] = useState(from ? String(from) : ''), [b, setB] = useState(to ? String(to) : '');
  const [error, setError] = useState('');
  async function save() {
    const start = Number(a), end = Number(b);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || (max && end > max)) { setError(max ? `Use páginas de 1 a ${max}, com a inicial antes da final.` : 'A página inicial precisa vir antes da final.'); return; }
    try { await onSave(start, end); } catch (e) { setError((e as Error).message); }
  }
  return (
    <div className="pdf-range" style={{ width: '100%' }}>
      <label className="muted small">Da página <input className="input pdf-page" type="number" min={1} max={max} value={a} onChange={(e) => setA(e.target.value)} /></label>
      <label className="muted small">até <input className="input pdf-page" type="number" min={1} max={max} value={b} onChange={(e) => setB(e.target.value)} /></label>
      <button className="btn sm" onClick={save}>Salvar</button>
      <button className="btn ghost sm" onClick={onCancel}>Cancelar</button>
      {error && <p className="error" role="alert" style={{ margin: 0, width: '100%' }}>{error}</p>}
    </div>
  );
}
