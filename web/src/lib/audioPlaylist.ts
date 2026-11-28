// Playlist das revisões em áudio: biblioteca do concurso (função audio-review, ação library) e as marcas do estudante
// (fixar ou tirar um trecho), gravadas direto na tabela com RLS.
import { useQuery } from '@tanstack/react-query';
import type { Clip, Mark, ThemeState } from '../../../shared/audio/playlist.ts';
import type { Timeline } from '../../../shared/audio/script.ts';
import { invoke } from './audioReview.ts';
import { supabase } from './supabase.ts';

export interface LibraryReview { id: string; title: string; createdAt: string; weekOf: string | null; durationMs: number | null; voice: string; timeline: Timeline }
export interface Library { reviews: LibraryReview[]; clips: Clip[]; themes: ThemeState[] }

export const useAudioLibrary = (planId: string | undefined) => useQuery({
  queryKey: ['audio-library', planId], enabled: !!planId, staleTime: 5 * 60_000,
  queryFn: () => invoke<Library>({ action: 'library', planId }),
});

export const usePlaylistMarks = (planId: string | undefined) => useQuery({
  queryKey: ['audio-marks', planId], enabled: !!planId,
  queryFn: async () => {
    const { data, error } = await supabase.from('audio_playlist_marks').select('review_id, chapter_id, mark');
    if (error) throw new Error(error.message);
    return new Map((data ?? []).map((m) => [`${m.review_id}:${m.chapter_id}`, m.mark as Mark]));
  },
});

// null tira a marca.
export async function setPlaylistMark(clip: Pick<Clip, 'reviewId' | 'chapterId'>, mark: Mark | null) {
  const { error } = mark
    ? await supabase.from('audio_playlist_marks').upsert({ review_id: clip.reviewId, chapter_id: clip.chapterId, mark }, { onConflict: 'owner_id,review_id,chapter_id' })
    : await supabase.from('audio_playlist_marks').delete().eq('review_id', clip.reviewId).eq('chapter_id', clip.chapterId);
  if (error) throw new Error(error.message);
}
