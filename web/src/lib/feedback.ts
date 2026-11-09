// Relatos de bug/sugestão (Edge Function "feedback"). Listar e triar é só para admin (ADMIN_EMAILS no servidor).
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase.ts';

export type FeedbackStatus = 'novo' | 'resolvido' | 'descartado';
export interface FeedbackItem {
  id: string; email: string | null; kind: 'bug' | 'sugestao' | 'outro'; message: string; page: string | null; user_agent: string | null;
  emailed: boolean; status: FeedbackStatus; admin_note: string | null; created_at: string; resolved_at: string | null;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('feedback', { body });
  if (error) {
    let msg = error.message;
    try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* sem JSON */ }
    throw new Error(msg);
  }
  return data as T;
}

export const sendFeedback = (kind: FeedbackItem['kind'], message: string) =>
  invoke<{ ok: true }>({ kind, message, page: location.pathname + location.search, userAgent: navigator.userAgent });

// Quem não é admin recebe 403: a query falha sem repetir, e a tela de Conta esconde o atalho.
export const useFeedbackList = () => useQuery({
  queryKey: ['feedback-admin'],
  queryFn: () => invoke<{ items: FeedbackItem[] }>({ action: 'list' }).then((r) => r.items),
  retry: false, staleTime: 60_000,
});

export const updateFeedback = (id: string, patch: { status?: FeedbackStatus; note?: string }) => invoke<{ ok: true }>({ action: 'update', id, ...patch });
