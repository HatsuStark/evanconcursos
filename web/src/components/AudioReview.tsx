import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, Headphones, ListOrdered, Music, Pause, Play, RotateCcw, RotateCw, Volume2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_DURATION, DEFAULT_VOICE, DURATIONS } from '../../../shared/audio/config.ts';
import {
  answerAudioQuiz, buildAudio, fmtTime, isWorking, retryAudioReview, saveAudioProgress, stageLabel, startAudioReview, useAudioReview, useMusicAvailable,
  type AudioReview as Review, type QuizResult,
} from '../lib/audioReview.ts';

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const BUCKET = { recentes: 'recente', anteriores: 'reforço', erros: 'erros' } as Record<string, string>;
const PREF = 'audio-review:prefs';
const readPrefs = (): { music?: boolean; speed?: number; volume?: number } => { try { return JSON.parse(localStorage.getItem(PREF) ?? '{}'); } catch { return {}; } };
const writePrefs = (p: object) => { try { localStorage.setItem(PREF, JSON.stringify({ ...readPrefs(), ...p })); } catch { /* armazenamento bloqueado */ } };

// "Sua revisão em áudio": no dia da revisão semanal, uma revisão falada e personalizada (perguntas antes das respostas,
// pausas para lembrar, correção), gerada sob pedido. Pode sair da página enquanto ela é preparada.
export function AudioReview({ taskId }: { taskId: string }) {
  const qc = useQueryClient();
  const q = useAudioReview(taskId);
  const [duration, setDuration] = useState<number>(DEFAULT_DURATION);
  const [voice, setVoice] = useState<string>(DEFAULT_VOICE);
  const [music, setMusic] = useState<boolean>(readPrefs().music ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const review = q.data?.review ?? null;
  const musicQ = useMusicAvailable(), musicOk = musicQ.data === true;

  async function run(fn: () => Promise<{ review: Review }>) {
    setBusy(true); setError('');
    try { const { review: r } = await fn(); qc.setQueryData(['audio-review', taskId], (old: typeof q.data) => ({ ...(old ?? { used: 0, limit: 1 }), review: r })); void q.refetch(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const head = (
    <div className="daily-review-head">
      <Headphones size={22} style={{ color: 'var(--lime)' }} />
      <div style={{ flex: 1, minWidth: 200 }}>
        <strong>Sua revisão em áudio</strong>
        <div className="muted small">{review?.title ?? 'Um professor revisando com você o que você estudou: perguntas, pausas para lembrar e correção.'}</div>
      </div>
    </div>
  );

  if (q.isLoading || musicQ.isLoading) return <div className="glass card">{head}<div className="spinner" /></div>;
  if (q.isError) return <div className="glass card grid" style={{ gap: 10 }}>{head}<p className="error" style={{ margin: 0 }}>{(q.error as Error).message}</p></div>;

  if (!review) {
    const used = q.data?.used ?? 0, limit = q.data?.limit ?? 1;
    return (
      <div className="glass card grid" style={{ gap: 12 }}>
        {head}
        <p className="muted small" style={{ margin: 0 }}>
          Feita com os temas desta semana, os erros que você teve e as apostilas. Escute sem olhar a tela: responda de cabeça nas pausas. Dá para baixar o MP3.
        </p>
        <div className="audio-options">
          <Choice label="Duração" value={String(duration)} onChange={(v) => setDuration(Number(v))} options={DURATIONS.map((d) => ({ v: String(d), t: d === 10 ? '10 min · expressa' : d === 20 ? '20 min · recomendada' : '30 min · aprofundada' }))} />
          <Choice label="Voz" value={voice} onChange={setVoice} options={[{ v: 'feminina', t: 'Feminina' }, { v: 'masculina', t: 'Masculina' }]} />
          {musicOk && <Choice label="Ambiente" value={music ? 'lofi' : 'sem'} onChange={(v) => { setMusic(v === 'lofi'); writePrefs({ music: v === 'lofi' }); }} options={[{ v: 'lofi', t: 'Trilha lo-fi' }, { v: 'sem', t: 'Sem música' }]} />}
        </div>
        {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
        <div className="daily-review-head">
          <button className="btn" disabled={busy || used >= limit} onClick={() => run(() => startAudioReview(taskId, duration, voice))}><Headphones size={16} /> Gerar revisão em áudio</button>
          <span className="faint small">{used >= limit ? 'A revisão em áudio desta semana já foi gerada.' : `${limit === 1 ? 'Uma geração' : `${limit} gerações`} por revisão semanal · leva alguns minutos`}</span>
        </div>
      </div>
    );
  }

  if (isWorking(review.status)) {
    return (
      <div className="glass card grid" style={{ gap: 12 }}>
        {head}
        <div className="daily-review-head"><div className="spinner" /><span>{stageLabel(review)}…</span></div>
        <p className="muted small" style={{ margin: 0 }}>Pode sair desta página: a revisão continua sendo preparada e fica aqui quando terminar.</p>
        <Themes review={review} />
      </div>
    );
  }

  if (review.status === 'failed') {
    return (
      <div className="glass card grid" style={{ gap: 12 }}>
        {head}
        <p className="error" style={{ margin: 0 }}>{review.error ?? 'A geração não terminou.'}</p>
        {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
        <div><button className="btn" disabled={busy} onClick={() => run(() => retryAudioReview(review.id))}><RotateCw size={16} /> Tentar retomar</button></div>
        <span className="faint small">Retomar continua de onde parou e não conta como nova geração.</span>
      </div>
    );
  }

  return (
    <div className="glass card grid" style={{ gap: 12 }}>
      {head}
      <Player review={review} initialMusic={musicOk && (review.music ?? music)} musicAvailable={musicOk} />
      <Themes review={review} />
      <RetentionQuiz review={review} />
    </div>
  );
}

function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { v: string; t: string }[] }) {
  return (
    <div className="grid" style={{ gap: 6 }}>
      <span className="faint small">{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((o) => <button key={o.v} type="button" className={value === o.v ? 'on' : ''} aria-pressed={value === o.v} onClick={() => onChange(o.v)}>{o.t}</button>)}
      </div>
    </div>
  );
}

// Assuntos e por que entraram (dados reais: dias desde o estudo, revisão anterior, acertos).
function Themes({ review }: { review: Review }) {
  if (!review.themes.length) return null;
  return (
    <details className="audio-themes">
      <summary className="muted small">Personalizada: {review.themes.length} {review.themes.length === 1 ? 'tema' : 'temas'}{review.errors ? ` e ${review.errors} ${review.errors === 1 ? 'questão errada' : 'questões erradas'}` : ''}</summary>
      <ul className="weekly-list">
        {review.themes.map((t) => (
          <li key={t.id}><span>{t.title}</span><span className="faint small">{[t.subject, BUCKET[t.bucket], t.reasons.slice(0, 2).join(' · ')].filter(Boolean).join(' · ')}</span></li>
        ))}
      </ul>
    </details>
  );
}

function Player({ review, initialMusic, musicAvailable }: { review: Review; initialMusic: boolean; musicAvailable: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  // A tela atualiza a revisão de tempos em tempos; o áudio só é remontado quando muda a revisão ou a música.
  const current = useRef(review);
  current.current = review;
  const prefs = useMemo(readPrefs, []);
  const [music, setMusic] = useState(initialMusic);
  const [url, setUrl] = useState<string | null>(null);
  const [hasMusic, setHasMusic] = useState(true);
  const [building, setBuilding] = useState<number | null>(0);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(review.positionMs);
  const [speed, setSpeed] = useState(review.speed ?? prefs.speed ?? 1);
  const [volume, setVolume] = useState(prefs.volume ?? 1);
  const [showChapters, setShowChapters] = useState(false);
  const resumeAt = useRef(review.positionMs < (review.durationMs ?? 0) * 0.97 ? review.positionMs : 0);
  const listened = useRef(0), lastTick = useRef<number | null>(null), lastSave = useRef(0);
  const total = review.durationMs ?? review.timeline?.totalMs ?? 0;
  const chapters = review.timeline?.chapters ?? [];

  // Monta a versão pedida (ou pega do cache). Na troca com/sem música, a posição continua a mesma: as duas versões têm a
  // mesma linha do tempo.
  useEffect(() => {
    let off = false, made: string | null = null;
    setBuilding(0); setError('');
    buildAudio(current.current, music, (f) => { if (!off) setBuilding(f); }).then(({ blob, music: m }) => {
      if (off) return;
      made = URL.createObjectURL(blob);
      if (music && !m) setHasMusic(false);
      setUrl(made); setBuilding(null);
    }).catch((e) => { if (!off) { setError((e as Error).message); setBuilding(null); } });
    return () => { off = true; if (made) URL.revokeObjectURL(made); };
  }, [review.id, music]);

  const save = (extra: { completed?: boolean } = {}) => {
    const el = audio.current;
    if (!el) return;
    lastSave.current = Date.now();
    void saveAudioProgress(review.id, { positionMs: Math.round(el.currentTime * 1000), listenedMs: Math.round(listened.current), music, speed, ...extra });
  };

  useEffect(() => {
    const el = audio.current;
    if (!el || !url) return;
    const wasPlaying = playing;
    el.src = url;
    el.playbackRate = speed; el.volume = volume;
    const onMeta = () => { el.currentTime = resumeAt.current / 1000; if (wasPlaying) void el.play().catch(() => {}); };
    el.addEventListener('loadedmetadata', onMeta, { once: true });
    return () => el.removeEventListener('loadedmetadata', onMeta);
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (audio.current) audio.current.playbackRate = speed; writePrefs({ speed }); }, [speed]);
  useEffect(() => { if (audio.current) audio.current.volume = volume; writePrefs({ volume }); }, [volume]);

  // Media Session: controles na tela bloqueada e nos fones, e áudio em segundo plano no celular.
  useEffect(() => {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    const el = audio.current;
    if (!ms || !el || !url) return;
    try {
      ms.metadata = new MediaMetadata({ title: review.title ?? 'Revisão em áudio', artist: 'Evan Concursos', album: 'Revisão da semana' });
      ms.setActionHandler('play', () => void el.play());
      ms.setActionHandler('pause', () => el.pause());
      ms.setActionHandler('seekbackward', () => { el.currentTime = Math.max(0, el.currentTime - 15); });
      ms.setActionHandler('seekforward', () => { el.currentTime = Math.min(el.duration || 0, el.currentTime + 15); });
      ms.setActionHandler('seekto', (d) => { if (d.seekTime != null) el.currentTime = d.seekTime; });
    } catch { /* navegador sem suporte a alguma ação */ }
  }, [url, review.title]);

  useEffect(() => () => { if (audio.current && !audio.current.paused) save(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const el = () => audio.current!;
  const seek = (ms: number) => { const a = audio.current; if (a) { a.currentTime = Math.max(0, Math.min(total, ms) / 1000); setTime(a.currentTime * 1000); } };
  const toggleMusic = () => { resumeAt.current = (audio.current?.currentTime ?? 0) * 1000; setMusic(!music); writePrefs({ music: !music }); };
  const chapterAt = [...chapters].reverse().find((c) => c.startMs <= time);

  return (
    <div className="grid" style={{ gap: 10 }}>
      <audio
        ref={audio} preload="auto"
        onPlay={() => { setPlaying(true); lastTick.current = performance.now(); }}
        onPause={() => { setPlaying(false); lastTick.current = null; save(); }}
        onEnded={() => { setPlaying(false); save({ completed: true }); }}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime * 1000;
          setTime(t);
          const now = performance.now();
          if (lastTick.current !== null) listened.current += Math.min(2000, now - lastTick.current);
          lastTick.current = e.currentTarget.paused ? null : now;
          if (Date.now() - lastSave.current > 15_000) save();
        }}
      />
      {building !== null && <div className="grid" style={{ gap: 6 }}><span className="muted small">Finalizando o áudio no seu aparelho…</span><div className="bar"><span style={{ width: `${Math.round(building * 100)}%`, background: 'var(--lime)' }} /></div></div>}
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      {url && (
        <>
          <div className="audio-player">
            <button className="btn ghost sm" aria-label="Voltar 15 segundos" onClick={() => seek(time - 15000)}><RotateCcw size={16} /> 15</button>
            <button className="btn audio-play" aria-label={playing ? 'Pausar' : 'Tocar'} onClick={() => (playing ? el().pause() : void el().play())}>{playing ? <Pause size={20} /> : <Play size={20} />}</button>
            <button className="btn ghost sm" aria-label="Avançar 15 segundos" onClick={() => seek(time + 15000)}>15 <RotateCw size={16} /></button>
          </div>
          <input className="audio-seek" type="range" min={0} max={Math.max(1, Math.round(total))} step={1000} value={Math.round(time)} aria-label="Posição" onChange={(e) => seek(Number(e.target.value))} />
          <div className="audio-meta faint small"><span>{fmtTime(time)}</span><span className="audio-chapter">{chapterAt?.titulo ?? ''}</span><span>{fmtTime(total)}</span></div>
          <div className="audio-controls">
            <label className="faint small">Velocidade{' '}
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>{SPEEDS.map((s) => <option key={s} value={s}>{String(s).replace('.', ',')}x</option>)}</select>
            </label>
            <label className="faint small audio-volume"><Volume2 size={15} /><input type="range" min={0} max={1} step={0.05} value={volume} aria-label="Volume" onChange={(e) => setVolume(Number(e.target.value))} /></label>
            {hasMusic && musicAvailable && <button className={`btn ghost sm${music ? ' on' : ''}`} onClick={toggleMusic} disabled={building !== null}><Music size={15} /> {music ? 'Com trilha' : 'Sem música'}</button>}
            {chapters.length > 1 && <button className="btn ghost sm" onClick={() => setShowChapters(!showChapters)}><ListOrdered size={15} /> Capítulos</button>}
            <a className="btn ghost sm" href={url} download={`revisao-em-audio${music ? '' : '-sem-musica'}.mp3`}><Download size={15} /> Baixar MP3</a>
          </div>
          {showChapters && (
            <ol className="weekly-list audio-chapters">
              {chapters.map((c) => <li key={c.id}><button className="link-btn" onClick={() => { seek(c.startMs); void el().play(); }}>{c.titulo}</button><span className="faint small">{fmtTime(c.startMs)}</span></li>)}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

// Miniavaliação depois de ouvir: 5 questões diferentes das do áudio, corrigidas no servidor. Ouvir não prova domínio;
// a nota é o que mede a retenção.
function RetentionQuiz({ review }: { review: Review }) {
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const qs = review.quiz ?? [];
  const listenedEnough = review.completed || review.maxPositionMs >= (review.durationMs ?? Infinity) * 0.8;
  useEffect(() => {
    if (review.quizResult && !result) void answerAudioQuiz(review.id, review.quizResult.answers).then(setResult).catch(() => {});
  }, [review.id, review.quizResult, result]);
  if (!qs.length) return null;
  if (!open && !result) {
    return (
      <div className="daily-review-head">
        <CheckCircle2 size={18} style={{ color: listenedEnough ? 'var(--lime)' : 'var(--muted)' }} />
        <span className="small" style={{ flex: 1 }}>{listenedEnough ? 'Terminou de ouvir? Veja o que ficou: 5 questões rápidas.' : 'No fim do áudio, 5 questões rápidas para ver o que ficou.'}</span>
        <button className="btn ghost sm" onClick={() => setOpen(true)}>Fazer a miniavaliação</button>
      </div>
    );
  }
  async function submit() {
    setBusy(true); setError('');
    try { setResult(await answerAudioQuiz(review.id, qs.map((_, i) => answers[i] ?? -1))); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="grid" style={{ gap: 12 }}>
      <strong>Miniavaliação{result ? ` · ${result.score} de ${result.total}` : ''}</strong>
      {qs.map((q, i) => (
        <div key={i} className="grid" style={{ gap: 6 }}>
          <div className="small">{i + 1}. {q.enunciado}</div>
          <div className="grid" style={{ gap: 4 }}>
            {q.alternativas.map((a, j) => {
              const chosen = (result?.answers[i] ?? answers[i]) === j, right = result && result.correct[i] === j;
              return (
                <button key={j} type="button" disabled={!!result} className={`audio-alt${chosen ? ' chosen' : ''}${right ? ' right' : ''}${result && chosen && !right ? ' wrong' : ''}`}
                  onClick={() => setAnswers((x) => { const n = [...x]; n[i] = j; return n; })}>
                  {String.fromCharCode(65 + j)}) {a}
                </button>
              );
            })}
          </div>
          {result && <div className="muted small">{result.comments[i]}</div>}
        </div>
      ))}
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      {!result && <div><button className="btn" disabled={busy || answers.filter((a) => a !== undefined).length < qs.length} onClick={submit}>Corrigir</button></div>}
    </div>
  );
}
