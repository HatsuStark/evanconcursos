import { FileUp, Lock } from 'lucide-react';
import { useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { NoticeRole } from '../../../shared/ai/notice.ts';
import { normalizeText } from '../../../shared/ai/notice.ts';
import { Shell } from '../components/Shell.tsx';
import { Steps } from '../components/ui.tsx';
import { listNoticeRoles, MAX_PDF_BYTES, rememberUpdate, startNoticeReading, uploadNoticeFile } from '../lib/notices.ts';

// Fluxo: PDF → lista de cargos do edital → o candidato escolhe o dele → leitura completa só desse cargo.
// Sem lista (falha ou edital sem quadro de cargos), o cargo é digitado, como antes.
export function NewNoticePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const updating = params.get('atualizar'); // edital do plano que o novo vai atualizar
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<{ noticeId: string; fileId: string } | null>(null);
  const [roles, setRoles] = useState<NoticeRole[] | null>(null); // null: ainda não listou; []: sem lista, digita
  const [picked, setPicked] = useState(-1);
  const [typed, setTyped] = useState('');
  const [filter, setFilter] = useState('');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const pick = (f: File | undefined) => {
    setError('');
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') return setError('Escolha um arquivo PDF.');
    if (f.size > MAX_PDF_BYTES) return setError('O PDF passa de 20 MB.');
    setFile(f); setUploaded(null); setRoles(null); setPicked(-1);
  };
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); };

  async function start(ids: { noticeId: string; fileId: string }, role: string, chosen?: { code: string; otherRoles: string[] }) {
    setBusy('Iniciando a leitura…');
    const jobId = await startNoticeReading(ids.noticeId, ids.fileId, role, chosen);
    if (updating) await rememberUpdate(ids.noticeId, updating);
    navigate(`/concursos/${ids.noticeId}/leitura/${jobId}`);
  }

  async function findRoles(e: FormEvent) {
    e.preventDefault();
    if (!file) return setError('Escolha o PDF do edital.');
    setError('');
    try {
      setBusy('Enviando…');
      const ids = uploaded ?? await uploadNoticeFile(file);
      setUploaded(ids);
      setBusy('Procurando os cargos do edital…');
      const list = await listNoticeRoles(ids.noticeId, ids.fileId).catch(() => [] as NoticeRole[]);
      if (list.length === 1) return await start(ids, list[0]!.name, { code: list[0]!.code, otherRoles: [] });
      setRoles(list); setBusy('');
    } catch (err) {
      setError((err as Error).message); setBusy('');
    }
  }

  async function read(e: FormEvent) {
    e.preventDefault();
    if (!uploaded || !roles) return;
    setError('');
    try {
      if (roles.length) {
        const r = roles[picked];
        if (!r) return setError('Escolha o seu cargo na lista.');
        await start(uploaded, r.name, { code: r.code, otherRoles: roles.filter((_, i) => i !== picked).map((o) => o.name) });
      } else await start(uploaded, typed);
    } catch (err) {
      setError((err as Error).message); setBusy('');
    }
  }

  const q = normalizeText(filter);
  const shown = (roles ?? []).map((r, i) => ({ r, i })).filter(({ r }) => !q || normalizeText(`${r.code} ${r.name}`).includes(q));

  return (
    <Shell title={updating ? 'Novo edital' : 'Novo concurso'} subtitle={updating ? 'Envie o novo edital em PDF. Depois de conferir, você vê o que mudou antes de qualquer alteração no plano.' : 'Envie o edital em PDF. A IA lê e organiza tudo para você conferir.'}>
      <Steps current={0} />
      {roles === null ? (
        <form className="glass card" style={{ display: 'grid', gap: 18, maxWidth: 720 }} onSubmit={findRoles}>
          <div className={'dropzone' + (over ? ' over' : '')} role="button" tabIndex={0}
            onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
            <FileUp />
            <strong>{file ? file.name : 'Arraste o PDF aqui ou clique para escolher'}</strong>
            <span className="muted small">{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : 'Edital completo, com o conteúdo programático · até 20 MB'}</span>
            <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => pick(e.target.files?.[0])} />
          </div>
          {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <button className="btn" disabled={!!busy || !file}>{busy ? <><span className="spinner" /> {busy}</> : 'Continuar'}</button>
            <span className="chip faint"><Lock /> O PDF fica guardado só na sua conta.</span>
          </div>
        </form>
      ) : (
        <form className="glass card" style={{ display: 'grid', gap: 14, maxWidth: 720 }} onSubmit={read}>
          {roles.length ? <>
            <div>
              <strong>Qual é o seu cargo?</strong>
              <p className="muted small" style={{ margin: '4px 0 0' }}>Encontramos {roles.length} cargos em {file?.name}. A leitura usa só a prova, o conteúdo e as atribuições do cargo escolhido.</p>
            </div>
            {roles.length > 8 && <input className="input" placeholder="Filtrar cargos" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar cargos" />}
            <div className="role-pick" role="radiogroup" aria-label="Cargos do edital">
              {shown.map(({ r, i }) => (
                <label key={i} className={picked === i ? 'on' : ''}>
                  <input type="radio" name="role" checked={picked === i} onChange={() => setPicked(i)} />
                  <span>{r.code && <span className="faint">{r.code} · </span>}{r.name}</span>
                  {r.educationLevel && <span className="faint small">{r.educationLevel}</span>}
                </label>
              ))}
              {!shown.length && <p className="faint small" style={{ margin: 0 }}>Nenhum cargo com esse nome.</p>}
            </div>
          </> : (
            <label className="field">Não foi possível listar os cargos deste edital. Digite o seu (se o edital tiver vários)
              <input className="input" placeholder="Ex.: Oficial de Justiça, Técnico Judiciário – Área Judiciária" value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={160} />
            </label>
          )}
          {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <button className="btn" disabled={!!busy || (!!roles.length && picked < 0)}>{busy ? <><span className="spinner" /> {busy}</> : 'Ler edital com IA'}</button>
            <button type="button" className="btn ghost" disabled={!!busy} onClick={() => { setRoles(null); setPicked(-1); setFilter(''); }}>Trocar PDF</button>
          </div>
        </form>
      )}
    </Shell>
  );
}
