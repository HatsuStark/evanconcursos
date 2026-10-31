import { useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { youtube } from '../../../shared/domain/materials.ts';
import type { Video } from '../../../shared/domain/videos.ts';
import { setVideoWatched, useSessionVideos, useWatchedVideos } from '../lib/videos.ts';

const PLAYER_ORIGIN = 'https://www.youtube-nocookie.com';
const fmtDuration = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
};
const fmtViews = new Intl.NumberFormat('pt-BR', { notation: 'compact' });

const UNAVAILABLE = {
  no_key: 'A busca de vídeos dentro do app ainda não foi configurada.',
  quota: 'A cota diária de buscas do YouTube acabou. Volta a funcionar amanhã.',
  error: 'Não foi possível buscar os vídeos agora.',
};

// Aba "Vídeos" do modo estudo. Fica montada depois de aberta, para o vídeo não voltar ao início ao trocar de aba;
// ao sair da aba (`visible` falso), o vídeo pausa.
export function VideosPanel({ taskId, noticeId, query, visible }: { taskId: string; noticeId: string; query: string; visible: boolean }) {
  const qc = useQueryClient();
  const videos = useSessionVideos(taskId);
  const watched = useWatchedVideos(noticeId);
  const [playing, setPlaying] = useState<Video | null>(null);
  const [error, setError] = useState('');
  const player = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!visible) player.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), PLAYER_ORIGIN);
  }, [visible]);

  async function toggleWatched(id: string) {
    setError('');
    try {
      await setVideoWatched(noticeId, id, !watched.data?.has(id));
      await qc.invalidateQueries({ queryKey: ['video-watches', noticeId] });
    } catch (e) { setError((e as Error).message); }
  }

  const searchLink = <a className="btn ghost sm" href={youtube(query)} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Buscar no YouTube</a>;
  if (videos.isLoading) return <div className="spinner" />;
  const status = videos.data?.status ?? 'error', list = videos.data?.videos ?? [];
  if (status !== 'ok' || !list.length) {
    return (
      <div className="glass card">
        <p className="muted" style={{ marginTop: 0 }}>{status === 'ok' ? 'Nenhum vídeo sobre este tema passou nos filtros (duração, tema e disponibilidade).' : UNAVAILABLE[status]}</p>
        {searchLink}
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 14 }}>
      {playing && (
        <div className="glass card">
          <iframe
            ref={player}
            key={playing.id}
            className="video-player"
            src={`${PLAYER_ORIGIN}/embed/${playing.id}?autoplay=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`}
            title={playing.title}
            referrerPolicy="strict-origin-when-cross-origin"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
          <strong style={{ display: 'block', marginTop: 12 }}>{playing.title}</strong>
          <div className="material-row" style={{ marginTop: 8 }}>
            <span className="muted small" style={{ flex: 1 }}>{playing.channel}</span>
            <button className="btn ghost sm" onClick={() => toggleWatched(playing.id)}><Check size={15} /> {watched.data?.has(playing.id) ? 'Assistido · desfazer' : 'Marcar como assistido'}</button>
            <a className="btn ghost sm" href={`https://www.youtube.com/watch?v=${playing.id}`} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Abrir no YouTube</a>
          </div>
        </div>
      )}
      <div className="video-grid">
        {list.map((v) => (
          <button key={v.id} className={'glass video-card' + (playing?.id === v.id ? ' on' : '')} onClick={() => setPlaying(v)}>
            <span className="video-thumb">
              <img src={v.thumb} alt="" loading="lazy" />
              <span className="video-duration">{fmtDuration(v.durationSec)}</span>
              {watched.data?.has(v.id) ? <span className="video-seen"><Check size={13} /> assistido</span> : <Play className="video-play" size={30} />}
            </span>
            <strong>{v.title}</strong>
            <span className="muted small">{v.channel}</span>
            <span className="faint small">{fmtViews.format(v.views)} visualizações · {new Date(v.publishedAt).getFullYear()}</span>
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="material-row">
        <p className="faint small" style={{ margin: 0, flex: 1 }}>Vídeos da busca do YouTube, sem revisão. Em legislação, confira o ano: a lei pode ter mudado.</p>
        {searchLink}
      </div>
    </div>
  );
}
