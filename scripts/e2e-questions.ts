// Teste ponta a ponta da Edge Function "questions" com um usuário temporário (criado e apagado aqui).
// Uso: node --experimental-strip-types scripts/e2e-questions.ts
// Pré-requisito (decisão do dono do projeto): incluir e2e@evanconcursos.test em ALLOWED_EMAILS e publicar os
// segredos (node scripts/deploy-functions.mjs). Sem isso a função responde 403. Gasta poucos créditos da Quest API.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const root = new URL('..', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('.env', root), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const cfg = readFileSync(new URL('web/src/config.ts', root), 'utf8');
const SUPABASE_URL = /https:\/\/[a-z0-9]+\.supabase\.co/.exec(cfg)![0], ANON = /sb_publishable_[A-Za-z0-9_-]+/.exec(cfg)![0];
const url = new URL(readFileSync(new URL('supabase/.temp/pooler-url', root), 'utf8').trim()); url.password = encodeURIComponent(env.SUPABASE_DB_PASSWORD!);
const db = new pg.Client({ connectionString: url.href, ssl: { rejectUnauthorized: false } }); await db.connect();
const EMAIL = 'e2e@evanconcursos.test', PASSWORD = randomBytes(18).toString('base64url');
const ok = (cond: unknown, msg: string) => { console.log(`${cond ? 'ok  ' : 'FALHA'} ${msg}`); if (!cond) process.exitCode = 1; };

await db.query(`delete from auth.users where email = $1`, [EMAIL]);
try {
  const { rows: [u] } = await db.query(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
     values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1, extensions.crypt($2, extensions.gen_salt('bf')), now(),
             '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '') returning id`, [EMAIL, PASSWORD]);
  await db.query(`insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), $1::uuid, $2::text, json_build_object('sub', $2::text, 'email', $3::text, 'email_verified', true), 'email', now(), now(), now())`, [u.id, String(u.id), EMAIL]);
  const auth = await (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).json() as { access_token?: string; error_description?: string };
  ok(auth.access_token, `login do usuário de teste ${auth.error_description ?? ''}`);
  const call = async (body: Record<string, unknown>) => {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/questions`, { method: 'POST', headers: { Authorization: `Bearer ${auth.access_token}`, apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, data: await r.json() as Record<string, any> };
  };

  // Dados mínimos: edital conferido, matéria com tópico, plano, sessão de Peculato e duas tarefas (teoria e reforço).
  const q1 = (s: string, p: unknown[]) => db.query(s, p).then((r) => r.rows[0]);
  const notice = await q1(`insert into public.notices (owner_id, title, role_name, board, status, exam_date) values ($1, 'E2E', 'Escrevente Técnico Judiciário', 'VUNESP', 'reviewed', current_date + 200) returning id`, [u.id]);
  const subject = await q1(`insert into public.notice_subjects (owner_id, notice_id, name, is_core, weight) values ($1, $2, 'Direito Penal', true, 4) returning id`, [u.id, notice.id]);
  const topic = await q1(`insert into public.notice_topics (owner_id, subject_id, text) values ($1, $2, 'DIREITO PENAL: Código Penal - artigos 312 a 317; 319 a 327') returning id`, [u.id, subject.id]);
  const plan = await q1(`insert into public.study_plans (owner_id, notice_id, name) values ($1, $2, 'E2E') returning id`, [u.id, notice.id]);
  const ver = await q1(`insert into public.plan_versions (owner_id, plan_id, number, inputs) values ($1, $2, 1, '{}') returning id`, [u.id, plan.id]);
  const session = await q1(`insert into public.study_sessions (owner_id, plan_version_id, subject_id, position, title, keyword, topic_ids) values ($1, $2, $3, 0, 'Funcionário Público e Peculato: conceito e modalidades (CP, arts. 327 e 312 a 315)', 'peculato', array[$4::uuid]) returning id`, [u.id, ver.id, subject.id, topic.id]);
  const task = await q1(`insert into public.tasks (owner_id, plan_id, date, minutes, kind, subject_id, session_id, title, keyword, goal_questions, created_in_version) values ($1, $2, current_date, 120, 'theory', $3, $4, 'Peculato', 'peculato', 20, $5) returning id`, [u.id, plan.id, subject.id, session.id, ver.id]);
  const weak = await q1(`insert into public.tasks (owner_id, plan_id, date, minutes, kind, subject_id, title, goal_questions, created_in_version) values ($1, $2, current_date + 1, 120, 'consolidation', $3, 'Reforço', 20, $4) returning id`, [u.id, plan.id, subject.id, ver.id]);

  const t0 = Date.now();
  const n1 = await call({ action: 'next', taskId: task.id, count: 3 });
  ok(n1.status === 200 && n1.data.questions?.length === 3, `next: ${n1.status} · ${n1.data.questions?.length ?? 0} questões em ${Math.round((Date.now() - t0) / 1000)}s ${n1.data.error ?? ''} ${n1.data.detail ?? ''}`);
  console.log(`     filtro: ${n1.data.filter?.materia} · ${(n1.data.filter?.assuntos ?? []).join(' | ')} (${n1.data.filter?.how})`);
  for (const q of n1.data.questions ?? []) console.log(`     · ${q.assunto} · ${q.prova?.banca} ${q.prova?.ano} ${q.prova?.orgao} · ${q.alternativas.length} alternativas`);
  ok((n1.data.questions ?? []).every((q: Record<string, unknown>) => !('gabarito' in q)), 'gabarito não vai ao navegador');

  const first = n1.data.questions?.[0];
  if (first) {
    const a = await call({ action: 'answer', taskId: task.id, qid: first.qid, chosen: 'A' });
    ok(a.status === 200 && typeof a.data.correct === 'boolean' && a.data.gabarito, `answer: ${a.status} · marcou A → ${a.data.correct ? 'acertou' : 'errou'} (gabarito ${a.data.gabarito})`);
    const { rows: att } = await db.query(`select correct from public.question_attempts where owner_id = $1`, [u.id]);
    ok(att.length === 1 && att[0].correct === a.data.correct, 'tentativa gravada com o acerto decidido no servidor');
    const t1 = Date.now();
    const e = await call({ action: 'explain', taskId: task.id, qid: first.qid });
    ok(e.status === 200 && e.data.explanation?.resumo, `explain: ${e.status} em ${Math.round((Date.now() - t1) / 1000)}s · artigos: ${(e.data.explanation?.artigos ?? []).join('; ') || '—'} · fontes fornecidas: ${(e.data.explanation?.fontes ?? []).length}`);
    console.log(`     ${String(e.data.explanation?.resumo ?? e.data.detail ?? '').slice(0, 300)}`);
    const e2 = await call({ action: 'explain', taskId: task.id, qid: first.qid });
    ok(e2.data.cached === true, 'explicação reaproveitada do cache');
  }
  const n2 = await call({ action: 'next', taskId: task.id, count: 3 });
  const ids1 = new Set((n1.data.questions ?? []).map((q: { qid: string }) => q.qid));
  ok(n2.status === 200 && (n2.data.questions ?? []).every((q: { qid: string }) => !ids1.has(q.qid) || q.qid !== first?.qid), `next de novo: ${n2.data.questions?.length ?? 0} questões, sem repetir a respondida`);
  const w = await call({ action: 'next', taskId: weak.id, count: 2 });
  ok(w.status === 200, `reforço (sem sessão): ${w.data.questions?.length ?? 0} questões · ${(w.data.filter?.assuntos ?? []).join(' | ')} (${w.data.filter?.how ?? w.data.reason})`);
  const { rows: usage } = await db.query(`select operation, model, credits, cost_usd, status from public.ai_usage where owner_id = $1 order by created_at`, [u.id]);
  ok(usage.length >= 3, `consumo registrado: ${usage.map((r) => `${r.operation}/${r.status} ${r.credits} créditos${r.cost_usd ? ` US$ ${Number(r.cost_usd).toFixed(4)}` : ''}`).join(' · ')}`);
  const other = await (await fetch(`${SUPABASE_URL}/rest/v1/qbank_questions?select=gabarito&limit=1`, { headers: { apikey: ANON, Authorization: `Bearer ${auth.access_token}` } })).json() as unknown;
  ok(!Array.isArray(other) || (other as unknown[]).length === 0, 'API REST não expõe gabaritos ao usuário');
} finally {
  await db.query(`delete from auth.users where email = $1`, [EMAIL]);
  console.log('usuário de teste e dados apagados');
  await db.end();
}
