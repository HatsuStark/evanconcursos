// Painel do admin (Edge Function "admin"; o servidor confere ADMIN_EMAILS).
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase.ts';

export interface AdminOverview {
  days: number;
  users: { total: number; blocked: number; new7d: number; active1d: number; active7d: number; active30d: number; inactive7d: number };
  usage: {
    questions: number; accuracy: number | null; tasksDone: number; studyHours: number; guides: number; simulados: number; discursivas: number;
    reviews: number; reviewsDone: number; reviewRecall: number | null; reviewMinutes: number | null;
  };
  cost: {
    today: number; period: number; credits: number; perActiveUser: number | null;
    byOperation: { operation: string; calls: number; errors: number; usd: number; credits: number }[];
  };
  daily: { d: string; active: number; questions: number; usd: number }[];
}

export const useAdminOverview = (days: number) => useQuery({
  queryKey: ['admin-overview', days],
  queryFn: async () => {
    const { data, error } = await supabase.functions.invoke('admin', { body: { action: 'overview', days } });
    if (error) {
      let msg = error.message;
      try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* sem JSON */ }
      throw new Error(msg);
    }
    return data as AdminOverview;
  },
  retry: false, staleTime: 60_000,
});
