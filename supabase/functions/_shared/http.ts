// Código comum das Edge Functions: CORS, respostas JSON, usuário autenticado e cliente administrativo.
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { costUsd, type GeminiUsage } from '../../../shared/ai/gemini.ts';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// O detalhe técnico de um erro (mensagem do banco, da IA) fica só no log da função: não vai para o navegador.
export const json = (status: number, body: unknown) => {
  if (body && typeof body === 'object' && 'detail' in body) {
    const { detail, ...rest } = body as Record<string, unknown>;
    console.error(`[${status}]`, (rest as { error?: unknown }).error ?? '', detail);
    body = rest;
  }
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
};

const env = (k: string) => Deno.env.get(k) ?? '';
const emails = (k: string) => env(k).split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

// Teto diário de gasto com IA por usuário (USD, dia de São Paulo). E-mails em AI_UNLIMITED_EMAILS não têm teto.
// Conta o custo do Gemini (ai_usage.cost_usd); créditos da Quest API não têm preço em dólar e ficam fora.
// A conferência é antes da chamada: a última chamada do dia pode passar um pouco do teto.
const DEFAULT_DAILY_LIMIT_USD = 5;
const dailyLimitUsd = () => {
  const v = Number(env('AI_DAILY_LIMIT_USD'));
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_DAILY_LIMIT_USD;
};
const startOfDaySaoPaulo = () => `${new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)}T00:00:00-03:00`;

export async function spentTodayUsd(admin: SupabaseClient, ownerId: string) {
  const { data, error } = await admin.from('ai_usage').select('cost_usd').eq('owner_id', ownerId)
    .gte('created_at', startOfDaySaoPaulo()).not('cost_usd', 'is', null).limit(10000);
  if (error) throw new Error(error.message);
  return (data ?? []).reduce((sum, r) => sum + Number(r.cost_usd), 0);
}

// Cliente com a chave de serviço: ignora RLS. Só para o que o usuário não pode gravar (jobs, extrações, consumo).
export const adminClient = (): SupabaseClient =>
  createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

// Valida o token e devolve o usuário + um cliente que age como ele (RLS aplicada).
// Só e-mails em ALLOWED_EMAILS usam a IA (cada chamada tem custo), até o teto diário de gasto.
// `ai: false` dispensa a lista de e-mails e o teto (rotas sem custo de IA, como a lei seca).
export async function requireUser(req: Request, { ai = true } = {}): Promise<{ user: User; client: SupabaseClient } | Response> {
  const authorization = req.headers.get('Authorization') ?? '';
  const client = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data } = await client.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
  const user = data?.user;
  if (!user?.email) return json(401, { error: 'Entre na sua conta para continuar.' });
  const email = user.email.toLowerCase();
  if (!ai) return { user, client };
  if (!emails('ALLOWED_EMAILS').includes(email)) return json(403, { error: 'Sua conta ainda não tem acesso aos recursos de IA.' });
  if (!emails('AI_UNLIMITED_EMAILS').includes(email)) {
    // Sem conseguir medir o gasto, bloqueia: o teto existe para proteger o custo.
    const spent = await spentTodayUsd(adminClient(), user.id).catch((e) => { console.error('spentTodayUsd:', e); return Infinity; });
    if (spent >= dailyLimitUsd()) {
      // 403, não 429: o app repete chamadas que recebem 429.
      return json(403, { error: 'Você atingiu o limite diário de uso da IA. Ele volta à meia-noite (horário de Brasília).', code: 'daily_limit' });
    }
  }
  return { user, client };
}

// Registra consumo e custo de uma chamada à IA (ai_usage), com sucesso ou erro.
export async function logUsage(admin: SupabaseClient, u: {
  ownerId: string; jobId?: string | null; operation: string; model: string; promptVersion: string;
  usage: GeminiUsage | null; latencyMs: number | null; status: 'ok' | 'error'; error?: string; credits?: number;
}) {
  const price = u.usage ? await modelPrice(admin, u.model) : null;
  await admin.from('ai_usage').insert({
    owner_id: u.ownerId, job_id: u.jobId ?? null, operation: u.operation, model: u.model, prompt_version: u.promptVersion,
    input_tokens: u.usage?.inputTokens ?? 0, output_tokens: u.usage?.outputTokens ?? 0, thinking_tokens: u.usage?.thinkingTokens ?? 0,
    cost_usd: u.usage && price ? costUsd(u.usage, price) : null, latency_ms: u.latencyMs, status: u.status, error: u.error?.slice(0, 1000) ?? null,
    credits: u.credits ?? 0,
  });
}

// Preço vigente do modelo (USD por milhão de tokens); null se não cadastrado.
export async function modelPrice(admin: SupabaseClient, model: string) {
  const { data } = await admin.from('ai_model_prices').select('input_per_mtok_usd, output_per_mtok_usd')
    .eq('model', model).lte('effective_from', new Date().toISOString().slice(0, 10))
    .order('effective_from', { ascending: false }).limit(1).maybeSingle();
  return data ? { inputPerMtokUsd: Number(data.input_per_mtok_usd), outputPerMtokUsd: Number(data.output_per_mtok_usd) } : null;
}
