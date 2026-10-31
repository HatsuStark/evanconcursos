// Vídeos da sessão: chamada à função "videos" e marcações de assistido.
import { useQuery } from '@tanstack/react-query';
import type { Video } from '../../../shared/domain/videos.ts';
import { supabase } from './supabase.ts';

export type VideoStatus = 'ok' | 'no_key' | 'quota' | 'error';

// Só busca ao abrir a aba, e uma vez por tarefa: cada busca nova gasta a cota diária da API.
export const useSessionVideos = (taskId: string) => useQuery({
  queryKey: ['session-videos', taskId],
  staleTime: Infinity,
  retry: false,
  queryFn: async () => {
    const { data, error } = await supabase.functions.invoke('videos', { body: { taskId } });
    if (error) throw new Error(error.message);
    return data as { status: VideoStatus; videos: Video[] };
  },
});

export const useWatchedVideos = (noticeId: string) => useQuery({
  queryKey: ['video-watches', noticeId],
  queryFn: async () => {
    const { data, error } = await supabase.from('video_watches').select('video_id').eq('notice_id', noticeId);
    if (error) throw new Error(error.message);
    return new Set((data as { video_id: string }[]).map((w) => w.video_id));
  },
});

export async function setVideoWatched(noticeId: string, videoId: string, watched: boolean) {
  const { error } = watched
    ? await supabase.from('video_watches').upsert({ notice_id: noticeId, video_id: videoId }, { onConflict: 'owner_id,notice_id,video_id', ignoreDuplicates: true })
    : await supabase.from('video_watches').delete().eq('notice_id', noticeId).eq('video_id', videoId);
  if (error) throw new Error(error.message);
}
