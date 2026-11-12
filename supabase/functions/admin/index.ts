// Edge Function "admin": painel do administrador. Só e-mails em ADMIN_EMAILS (padrão: FEEDBACK_EMAIL).
// POST {action: 'overview', days?} → números gerais de uso e custo (função admin_overview no banco).
//      {action: 'ownBank'} → retrato do banco próprio de questões + uso em 30 dias.
//      {action: 'refreshOwnBank'} → recalcula o retrato (leva uns 20 s) e devolve o novo.
import { adminClient, CORS, isAdmin, json, requireUser } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
  const auth = await requireUser(req, { ai: false });
  if (auth instanceof Response) return auth;
  if (!isAdmin(auth.user.email ?? '')) return json(403, { error: 'Acesso restrito.' });
  const body = await req.json().catch(() => ({})) as { action?: string; days?: number };
  if (body.action === 'overview') {
    const days = Math.min(90, Math.max(1, Math.round(Number(body.days) || 30)));
    const { data, error } = await adminClient().rpc('admin_overview', { p_days: days });
    if (error) return json(500, { error: 'Falha ao calcular as estatísticas.', detail: error.message });
    return json(200, data);
  }
  if (body.action === 'ownBank' || body.action === 'refreshOwnBank') {
    const db = adminClient();
    if (body.action === 'refreshOwnBank') {
      const { error } = await db.rpc('admin_refresh_own_bank');
      if (error) return json(500, { error: 'Falha ao recalcular o banco próprio.', detail: error.message });
    }
    const { data, error } = await db.rpc('admin_own_bank');
    if (error) return json(500, { error: 'Falha ao ler o banco próprio.', detail: error.message });
    return json(200, data);
  }
  return json(400, { error: 'Ação desconhecida.' });
});
