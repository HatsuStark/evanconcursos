// Comentários por questão: tudo pelas funções do banco, que só liberam depois de responder a questão.
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase.ts';

export interface Comment { id: string; body: string; author: string; created_at: string; edited_at: string | null; hidden: boolean; mine: boolean; helpful: number; voted: boolean; reported: boolean }

async function rpc<T = void>(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const useComments = (qid: string) => useQuery({
  queryKey: ['comments', qid],
  queryFn: () => rpc<{ nickname: string | null; comments: Comment[] }>('comments_list', { p_qid: qid }),
});

export const setNickname = (nickname: string) => rpc('comment_set_nickname', { p_nickname: nickname });
export const addComment = (qid: string, body: string) => rpc('comment_add', { p_qid: qid, p_body: body });
export const editComment = (id: string, body: string) => rpc('comment_edit', { p_id: id, p_body: body });
export const deleteComment = (id: string) => rpc('comment_delete', { p_id: id });
export const voteComment = (id: string) => rpc('comment_vote', { p_id: id });
export const reportComment = (id: string) => rpc('comment_report', { p_id: id });
