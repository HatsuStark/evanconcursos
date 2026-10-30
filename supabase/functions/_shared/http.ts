// Código comum das Edge Functions: CORS, respostas JSON, usuário autenticado e cliente administrativo.
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const env = (k: string) => Deno.env.get(k) ?? '';

// Cliente com a chave de serviço: ignora RLS. Só para o que o usuário não pode gravar (jobs, extrações, consumo).
export const adminClient = (): SupabaseClient =>
  createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

// Valida o token e devolve o usuário + um cliente que age como ele (RLS aplicada).
// Enquanto não há cotas por usuário, só e-mails em ALLOWED_EMAILS usam a IA (cada chamada tem custo).
export async function requireUser(req: Request): Promise<{ user: User; client: SupabaseClient } | Response> {
  const authorization = req.headers.get('Authorization') ?? '';
  const client = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data } = await client.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
  const user = data?.user;
  if (!user?.email) return json(401, { error: 'Entre na sua conta para continuar.' });
  const allowed = env('ALLOWED_EMAILS').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(user.email.toLowerCase())) return json(403, { error: 'Sua conta ainda não tem acesso aos recursos de IA.' });
  return { user, client };
}

// Preço vigente do modelo (USD por milhão de tokens); null se não cadastrado.
export async function modelPrice(admin: SupabaseClient, model: string) {
  const { data } = await admin.from('ai_model_prices').select('input_per_mtok_usd, output_per_mtok_usd')
    .eq('model', model).lte('effective_from', new Date().toISOString().slice(0, 10))
    .order('effective_from', { ascending: false }).limit(1).maybeSingle();
  return data ? { inputPerMtokUsd: Number(data.input_per_mtok_usd), outputPerMtokUsd: Number(data.output_per_mtok_usd) } : null;
}
