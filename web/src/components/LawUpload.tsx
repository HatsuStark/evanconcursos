import { useQueryClient } from '@tanstack/react-query';
import { FileUp } from 'lucide-react';
import { useRef, useState } from 'react';
import type { UnlistedNorm } from '../../../shared/legal/norms.ts';
import { uploadLawPdf } from '../lib/legal.ts';

// Norma citada que o app não tem: o estudante envia o PDF oficial e passa a ter lei seca, apostila e questões da IA com
// os artigos dela. Fica só para ele.
export function LawUpload({ norm, compact = false }: { norm: UnlistedNorm; compact?: boolean }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const send = async (file: File) => {
    setBusy(true); setMsg(null);
    try {
      const r = await uploadLawPdf(file, norm.citation, norm.key);
      setMsg({ ok: true, text: `${r.short}: ${r.articles} artigos lidos (do art. ${r.first} ao ${r.last}).` });
      await qc.invalidateQueries({ queryKey: ['own-laws'] });
      await qc.invalidateQueries({ queryKey: ['law'] });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div className={compact ? '' : 'glass card'} style={{ display: 'grid', gap: 8 }}>
      <div>
        <strong>{norm.citation}</strong>
        {!compact && <div className="muted small">O app ainda não tem o texto desta norma. Envie o PDF oficial (com texto selecionável) para ler os artigos aqui e para a apostila e as questões da IA usarem o texto dela. Fica só para você.</div>}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input ref={input} type="file" accept="application/pdf" hidden onChange={(e) => e.target.files?.[0] && send(e.target.files[0])} />
        <button className="btn sm" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <span className="spinner" /> : <FileUp size={14} />} {busy ? 'Lendo o PDF…' : 'Enviar PDF'}
        </button>
        {msg && <span className={msg.ok ? 'small' : 'error small'}>{msg.text}</span>}
      </div>
    </div>
  );
}
