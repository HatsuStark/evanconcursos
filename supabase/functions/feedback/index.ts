// Edge Function "feedback": recebe relato de bug ou sugestão do balão do app, grava em public.feedback e avisa por
// e-mail (Resend) quando RESEND_API_KEY e FEEDBACK_EMAIL estão configurados. Sem eles, fica só no banco.
// POST {kind: 'bug'|'sugestao'|'outro', message, page?, userAgent?} → {ok: true}
import { adminClient, CORS, isAdmin, json, requireUser } from '../_shared/http.ts';

const KINDS = { bug: 'Bug', sugestao: 'Sugestão', outro: 'Outro' } as const;
const DAILY_LIMIT = 20;
const env = (k: string) => Deno.env.get(k) ?? '';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

async function sendEmail(subject: string, html: string, replyTo: string | undefined) {
  const key = env('RESEND_API_KEY'), to = env('FEEDBACK_EMAIL');
  if (!key || !to) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env('FEEDBACK_FROM') || 'Evan Concursos <onboarding@resend.dev>',
      to: to.split(',').map((e) => e.trim()).filter(Boolean),
      subject, html, ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  if (!res.ok) console.error('resend:', res.status, await res.text().catch(() => ''));
  return res.ok;
}

const STATUSES = ['novo', 'resolvido', 'descartado'];

// {action: 'list', status?} → {items} | {action: 'update', id, status?, note?} → {ok}
async function handleAdmin(body: Record<string, unknown>, email: string) {
  if (!isAdmin(email)) return json(403, { error: 'Acesso restrito.' });
  const db = adminClient();
  if (body.action === 'list') {
    let q = db.from('feedback').select('id, email, kind, message, page, user_agent, emailed, status, admin_note, created_at, resolved_at')
      .order('created_at', { ascending: false }).limit(200);
    if (STATUSES.includes(String(body.status))) q = q.eq('status', String(body.status));
    const { data, error } = await q;
    if (error) return json(500, { error: 'Falha ao listar.', detail: error.message });
    return json(200, { items: data });
  }
  const patch: Record<string, unknown> = {};
  if (body.status !== undefined) {
    if (!STATUSES.includes(String(body.status))) return json(400, { error: 'Status inválido.' });
    patch.status = body.status;
    patch.resolved_at = body.status === 'novo' ? null : new Date().toISOString();
  }
  if (body.note !== undefined) patch.admin_note = String(body.note).slice(0, 2000) || null;
  const { error } = await db.from('feedback').update(patch).eq('id', String(body.id ?? ''));
  if (error) return json(500, { error: 'Falha ao salvar.', detail: error.message });
  return json(200, { ok: true });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
  const auth = await requireUser(req, { ai: false });
  if (auth instanceof Response) return auth;
  const { user } = auth;
  const body = await req.json().catch(() => ({}));
  if (body.action === 'list' || body.action === 'update') return handleAdmin(body, user.email ?? '');
  const kind = String(body.kind ?? '') as keyof typeof KINDS;
  const message = String(body.message ?? '').trim().slice(0, 4000);
  if (!(kind in KINDS)) return json(400, { error: 'Escolha o tipo do relato.' });
  if (message.length < 3) return json(400, { error: 'Escreva o que aconteceu.' });
  const page = String(body.page ?? '').slice(0, 500) || null;
  const userAgent = String(body.userAgent ?? '').slice(0, 500) || null;

  const admin = adminClient();
  const since = new Date(Date.now() - 86400_000).toISOString();
  const { count } = await admin.from('feedback').select('id', { count: 'exact', head: true }).eq('owner_id', user.id).gte('created_at', since);
  if ((count ?? 0) >= DAILY_LIMIT) return json(403, { error: 'Muitos relatos hoje. Tente de novo amanhã.' });

  const { data: row, error } = await admin.from('feedback')
    .insert({ owner_id: user.id, email: user.email, kind, message, page, user_agent: userAgent }).select('id').single();
  if (error) return json(500, { error: 'Não foi possível enviar agora.', detail: error.message });

  const html = `<h2>${KINDS[kind]}</h2><p style="white-space:pre-wrap">${esc(message)}</p><hr>`
    + `<p><b>De:</b> ${esc(user.email ?? '')}<br><b>Página:</b> ${esc(page ?? '—')}<br><b>Navegador:</b> ${esc(userAgent ?? '—')}<br><b>ID:</b> ${row.id}</p>`;
  const sent = await sendEmail(`[Evan] ${KINDS[kind]}: ${message.slice(0, 60).replace(/\s+/g, ' ')}`, html, user.email).catch((e) => { console.error('resend:', e); return false; });
  if (sent) await admin.from('feedback').update({ emailed: true }).eq('id', row.id);
  return json(200, { ok: true });
});
