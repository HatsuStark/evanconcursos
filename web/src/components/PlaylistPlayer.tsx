import { ListOrdered, Music, Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { queueKey, type QueueItem } from '../../../shared/audio/playlist.ts';
import type { LibraryReview } from '../lib/audioPlaylist.ts';
import { buildAudio, fmtTime, readPrefs, useMusicAvailable, writePrefs } from '../lib/audioReview.ts';

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const RESUME = 'audio-playlist:resume';
const readResume = (): { key: string; idx: number; ms: number } | null => { try { return JSON.parse(localStorage.getItem(RESUME) ?? 'null'); } catch { return null; } };
const writeResume = (v: { key: string; idx: number; ms: number }) => { try { localStorage.setItem(RESUME, JSON.stringify(v)); } catch { /* armazenamento bloqueado */ } };

// Toca trechos de várias revisões em sequência. Cada revisão é montada uma vez no aparelho (e fica no cache do navegador);
// o trecho é um intervalo do MP3 dela. A revisão do trecho seguinte já é preparada enquanto o atual toca.
// Continua de onde parou quando a mesma fila é aberta de novo.
export function PlaylistPlayer({ name, items, reviews, onClose }: { name: string; items: QueueItem[]; reviews: LibraryReview[]; onClose: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const key = queueKey(items);
  const saved = useRef(readResume());
  const resumable = saved.current?.key === key && saved.current.idx < items.length;
  const [idx, setIdx] = useState(resumable ? saved.current!.idx : 0);
  const offset = useRef(resumable ? saved.current!.ms : 0); // posição dentro do trecho ao abrir
  const musicQ = useMusicAvailable(), musicOk = musicQ.data === true;
  const [music, setMusic] = useState(readPrefs().music ?? true);
  const [speed, setSpeed] = useState(readPrefs().speed ?? 1);
  const [playing, setPlaying] = useState(false);
  const [building, setBuilding] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [time, setTime] = useState(0); // dentro do trecho (ms)
  const [showList, setShowList] = useState(false);
  // Tocar assim que o trecho estiver pronto: a playlist abre pelo botão Tocar. Se o navegador barrar o play fora do toque
  // (iOS, montagem demorada), o botão de tocar fica disponível.
  const want = useRef(true);
  const urls = useRef(new Map<string, Promise<string>>());
  const loaded = useRef<string | null>(null); // revisão carregada no <audio>
  const lastSave = useRef(0);
  const byId = useRef(new Map(reviews.map((r) => [r.id, r])));
  byId.current = new Map(reviews.map((r) => [r.id, r]));
  const withMusic = music && musicOk;
  const clip = items[idx]?.clip;

  const ensure = (reviewId: string, progress?: (f: number) => void) => {
    const k = `${reviewId}:${withMusic}`;
    if (!urls.current.has(k)) {
      const r = byId.current.get(reviewId);
      const p = r ? buildAudio({ id: r.id, timeline: r.timeline }, withMusic, progress ?? (() => {})).then(({ blob }) => URL.createObjectURL(blob)) : Promise.reject(new Error('Revisão não encontrada.'));
      p.catch(() => urls.current.delete(k));
      urls.current.set(k, p);
    }
    return urls.current.get(k)!;
  };
  // Libera da memória as revisões que não são a atual nem a próxima.
  const prune = (keep: string[]) => {
    for (const [k, p] of urls.current) if (!keep.some((id) => k.startsWith(`${id}:`))) { void p.then((u) => URL.revokeObjectURL(u)).catch(() => {}); urls.current.delete(k); }
  };

  // Carrega o trecho atual (montando a revisão se preciso) e posiciona no começo dele.
  useEffect(() => {
    const el = audio.current;
    if (!el || !clip) return;
    let off = false;
    setError('');
    const k = `${clip.reviewId}:${withMusic}`;
    const startAt = () => {
      el.currentTime = (clip.startMs + offset.current) / 1000;
      offset.current = 0;
      setTime(el.currentTime * 1000 - clip.startMs);
      if (want.current) void el.play().catch(() => setPlaying(false));
      const next = items.slice(idx + 1).find((i) => i.clip.reviewId !== clip.reviewId)?.clip.reviewId;
      prune([clip.reviewId, ...(next ? [next] : [])]);
      if (next) void ensure(next).catch(() => {}); // prepara a próxima revisão enquanto esta toca
    };
    if (loaded.current === k) { startAt(); return; }
    setBuilding(0);
    ensure(clip.reviewId, (f) => { if (!off) setBuilding(f); }).then((url) => {
      if (off) return;
      setBuilding(null);
      loaded.current = k;
      el.src = url;
      el.playbackRate = speed;
      el.addEventListener('loadedmetadata', startAt, { once: true });
    }).catch((e) => { if (!off) { setBuilding(null); setError((e as Error).message); } });
    return () => { off = true; el.removeEventListener('loadedmetadata', startAt); };
  }, [idx, withMusic, key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (audio.current) audio.current.playbackRate = speed; writePrefs({ speed }); }, [speed]);
  useEffect(() => () => { for (const p of urls.current.values()) void p.then((u) => URL.revokeObjectURL(u)).catch(() => {}); }, []);

  const go = (i: number) => {
    if (i < 0 || i >= items.length) { if (i >= items.length) { want.current = false; audio.current?.pause(); } return; }
    want.current = want.current || playing;
    setIdx(i);
  };
  const seek = (ms: number) => {
    const el = audio.current;
    if (!el || !clip) return;
    const len = clip.endMs - clip.startMs;
    el.currentTime = (clip.startMs + Math.max(0, Math.min(len - 500, ms))) / 1000;
  };
  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (playing) { want.current = false; el.pause(); }
    else { want.current = true; if (loaded.current) void el.play().catch(() => setPlaying(false)); }
  };

  // Controles na tela bloqueada e nos fones, com pular trecho.
  useEffect(() => {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    const el = audio.current;
    if (!ms || !el || !clip) return;
    try {
      ms.metadata = new MediaMetadata({ title: clip.title, artist: 'Evan Concursos', album: name });
      ms.setActionHandler('play', () => { want.current = true; void el.play(); });
      ms.setActionHandler('pause', () => { want.current = false; el.pause(); });
      ms.setActionHandler('previoustrack', () => go(idx - 1));
      ms.setActionHandler('nexttrack', () => go(idx + 1));
      ms.setActionHandler('seekbackward', () => seek(el.currentTime * 1000 - clip.startMs - 15000));
      ms.setActionHandler('seekforward', () => seek(el.currentTime * 1000 - clip.startMs + 15000));
    } catch { /* navegador sem suporte a alguma ação */ }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (!clip) return null;
  const len = clip.endMs - clip.startMs;
  return (
    <div className="glass card grid playlist-player" style={{ gap: 10 }}>
      <audio
        ref={audio} preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => go(idx + 1)}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime * 1000 - clip.startMs;
          setTime(t);
          if (Date.now() - lastSave.current > 5000) { lastSave.current = Date.now(); writeResume({ key, idx, ms: Math.max(0, Math.round(t)) }); }
          if (t >= len) { if (idx + 1 < items.length) go(idx + 1); else { want.current = false; e.currentTarget.pause(); writeResume({ key, idx: 0, ms: 0 }); } }
        }}
      />
      <div className="daily-review-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="faint small">{name} · trecho {idx + 1} de {items.length}</span>
          <div className="playlist-now">{clip.title}</div>
          {!!items[idx]!.reasons.length && <span className="faint small">{items[idx]!.reasons.join(' · ')}</span>}
        </div>
        <button className="icon-btn" aria-label="Fechar playlist" onClick={() => { audio.current?.pause(); onClose(); }}><X size={18} /></button>
      </div>
      {building !== null && <div className="grid" style={{ gap: 6 }}><span className="muted small">Preparando o áudio desta revisão no seu aparelho…</span><div className="bar"><span style={{ width: `${Math.round(building * 100)}%`, background: 'var(--lime)' }} /></div></div>}
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      <div className="audio-player">
        <button className="btn ghost sm" aria-label="Trecho anterior" disabled={idx === 0} onClick={() => go(idx - 1)}><SkipBack size={16} /></button>
        <button className="btn ghost sm" aria-label="Voltar 15 segundos" onClick={() => seek(time - 15000)}><RotateCcw size={16} /> 15</button>
        <button className="btn audio-play" aria-label={playing ? 'Pausar' : 'Tocar'} onClick={toggle}>{playing ? <Pause size={20} /> : <Play size={20} />}</button>
        <button className="btn ghost sm" aria-label="Avançar 15 segundos" onClick={() => seek(time + 15000)}>15 <RotateCw size={16} /></button>
        <button className="btn ghost sm" aria-label="Próximo trecho" disabled={idx + 1 >= items.length} onClick={() => go(idx + 1)}><SkipForward size={16} /></button>
      </div>
      <input className="audio-seek" type="range" min={0} max={Math.max(1, Math.round(len))} step={1000} value={Math.max(0, Math.min(len, Math.round(time)))} aria-label="Posição no trecho" onChange={(e) => seek(Number(e.target.value))} />
      <div className="audio-meta faint small"><span>{fmtTime(time)}</span><span /><span>{fmtTime(len)}</span></div>
      <div className="audio-controls">
        <label className="faint small">Velocidade{' '}
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>{SPEEDS.map((s) => <option key={s} value={s}>{String(s).replace('.', ',')}x</option>)}</select>
        </label>
        {musicOk && (
          <div className="segmented" role="group" aria-label="Trilha">
            <button type="button" className={music ? 'on' : ''} aria-pressed={music} disabled={building !== null} onClick={() => { if (!music) { offset.current = time; want.current = playing; setMusic(true); writePrefs({ music: true }); } }}><Music size={13} /> Com trilha</button>
            <button type="button" className={!music ? 'on' : ''} aria-pressed={!music} disabled={building !== null} onClick={() => { if (music) { offset.current = time; want.current = playing; setMusic(false); writePrefs({ music: false }); } }}>Sem música</button>
          </div>
        )}
        <button className="btn ghost sm" onClick={() => setShowList(!showList)}><ListOrdered size={15} /> Fila</button>
      </div>
      {showList && (
        <ol className="weekly-list audio-chapters">
          {items.map((it, i) => (
            <li key={it.clip.key} className={i === idx ? 'playlist-on' : ''}>
              <button className="link-btn" onClick={() => { want.current = true; go(i); }}>{it.clip.title}</button>
              <span className="faint small">{fmtTime(it.clip.endMs - it.clip.startMs)}</span>
            </li>
          ))}
        </ol>
      )}
      {resumable && saved.current!.ms > 5000 && <span className="faint small">Continuando de onde você parou da última vez.</span>}
    </div>
  );
}
