import { FileUp, Lock } from 'lucide-react';
import { useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shell } from '../components/Shell.tsx';
import { Steps } from '../components/ui.tsx';
import { MAX_PDF_BYTES, uploadNotice } from '../lib/notices.ts';

export function NewNoticePage() {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [role, setRole] = useState('');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pick = (f: File | undefined) => {
    setError('');
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') return setError('Escolha um arquivo PDF.');
    if (f.size > MAX_PDF_BYTES) return setError('O PDF passa de 20 MB.');
    setFile(f);
  };
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return setError('Escolha o PDF do edital.');
    setBusy(true); setError('');
    try {
      const { noticeId, jobId } = await uploadNotice(file, role);
      navigate(`/concursos/${noticeId}/leitura/${jobId}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Shell title="Novo concurso" subtitle="Envie o edital em PDF. A IA lê e organiza tudo para você conferir.">
      <Steps current={0} />
      <form className="glass card" style={{ display: 'grid', gap: 18, maxWidth: 720 }} onSubmit={submit}>
        <div className={'dropzone' + (over ? ' over' : '')} role="button" tabIndex={0}
          onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
          <FileUp />
          <strong>{file ? file.name : 'Arraste o PDF aqui ou clique para escolher'}</strong>
          <span className="muted small">{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : 'Edital completo, com o conteúdo programático · até 20 MB'}</span>
          <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => pick(e.target.files?.[0])} />
        </div>
        <label className="field">Cargo (se o edital tiver vários)
          <input className="input" placeholder="Ex.: Oficial de Justiça, Técnico Judiciário – Área Judiciária" value={role} onChange={(e) => setRole(e.target.value)} maxLength={160} />
        </label>
        {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <button className="btn" disabled={busy || !file}>{busy ? <><span className="spinner" /> Enviando…</> : 'Ler edital com IA'}</button>
          <span className="chip faint"><Lock /> O PDF fica guardado só na sua conta.</span>
        </div>
      </form>
    </Shell>
  );
}
