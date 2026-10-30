// Código comum das Edge Functions com IA: CORS, resposta JSON, login permitido e chamada ao Gemini.
// Segredos (supabase secrets): GEMINI_API_KEY, GEMINI_MODEL, ALLOWED_EMAILS.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Valida o token do usuário e confere a lista de e-mails permitidos (cada chamada tem custo na API).
// Devolve uma resposta de erro, ou null se o usuário pode continuar.
export async function authorize(req: Request): Promise<Response | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const key = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', key);
  const { data: { user } = { user: null } } = await sb.auth.getUser(token);
  const allowed = (Deno.env.get('ALLOWED_EMAILS') ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!user?.email) return json(401, { error: 'Entre na sua conta para usar a IA.' });
  if (!allowed.includes(user.email.toLowerCase())) return json(403, { error: 'Sua conta não tem permissão para usar a IA.' });
  return null;
}

// Pede ao Gemini uma resposta JSON no formato `schema`. Devolve { data, model } ou uma resposta de erro.
export async function generate(parts: unknown[], schema: unknown, temperature: number) {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';
  if (!apiKey) return { error: json(500, { error: 'GEMINI_API_KEY não configurada no Supabase.' }) };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature },
    }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 400);
    const hint = res.status === 404 ? ` Modelo "${model}" não encontrado: ajuste GEMINI_MODEL.` : '';
    return { error: json(502, { error: `Falha no Gemini (${res.status}).${hint}`, detail }) };
  }
  const out = await res.json();
  const text = out?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
  if (!text) return { error: json(502, { error: 'O Gemini não devolveu conteúdo.' }) };
  return { data: JSON.parse(text), model };
}
