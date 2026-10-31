import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Shell } from '../components/Shell.tsx';
import { Steps } from '../components/ui.tsx';
import { useJob } from '../lib/notices.ts';

const STEPS = [
  { key: 'reading', label: 'Abrindo o PDF' },
  { key: 'analyzing', label: 'Lendo cargos, provas, matérias e conteúdo programático' },
  { key: 'checking', label: 'Conferindo os tópicos com o texto do edital' },
  { key: 'done', label: 'Pronto para você conferir' },
];

const STALLED_SEC = 180;

// Acompanha a leitura do edital (job em segundo plano) e segue para a conferência ao terminar.
export function ReadingPage() {
  const { noticeId, jobId } = useParams();
  const navigate = useNavigate();
  const job = useJob(jobId);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (job.data?.status === 'succeeded') navigate(`/concursos/${noticeId}/conferencia`, { replace: true });
  }, [job.data?.status, navigate, noticeId]);

  const step = job.data?.progress?.step ?? 'reading';
  const idx = Math.max(0, STEPS.findIndex((s) => s.key === step));
  const elapsed = job.data ? Math.round((now - new Date(job.data.created_at).getTime()) / 1000) : 0;
  // A função encerra em 150 s: passado esse tempo sem resposta, ela foi interrompida e a leitura não termina mais.
  const stalled = job.data?.status === 'running' && elapsed > STALLED_SEC;
  const failure = job.data?.status === 'failed' ? job.data.error : stalled ? 'A leitura foi interrompida antes de terminar. Tente de novo.' : null;

  return (
    <Shell title="Lendo o edital" subtitle="Leva de 30 segundos a 2 minutos. Pode deixar esta tela aberta.">
      <Steps current={0} />
      <div className="hero" style={{ maxWidth: 720 }}>
        {failure ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <h2 style={{ margin: 0 }}>Não foi possível ler o edital</h2>
            <p className="error" style={{ margin: 0 }}>{failure}</p>
            <Link className="btn" to="/concursos/novo" style={{ justifySelf: 'start' }}>Tentar de novo</Link>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 22 }}>
            <div className="progress-steps">
              {STEPS.map((s, i) => (
                <div key={s.key} className={'progress-step' + (i < idx ? ' done' : i === idx ? ' active' : '')}>
                  <span className="dot" /> {s.label}
                </div>
              ))}
            </div>
            <span className="faint small">{elapsed}s</span>
          </div>
        )}
      </div>
    </Shell>
  );
}
