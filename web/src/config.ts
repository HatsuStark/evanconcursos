// Configuração pública do Supabase (a chave publishable é feita para o navegador; RLS protege os dados).
// Pode ser sobrescrita por VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://srknqjjnwjudijbqhxyg.supabase.co';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'sb_publishable_OPqzyP3K7ApbdQAvSPxuFA_gD00Kmq_';
