// Teste ponta a ponta de excluir concurso com um usuário temporário (criado e apagado aqui): PDFs nos buckets
// privados e a função delete_notice, com o login real (mesmas chamadas de web/src/lib/notices.ts). Sem custo de IA.
// Uso: node --experimental-strip-types scripts/e2e-delete-notice.ts
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const root = new URL('..', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('.env', root), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const cfg = readFileSync(new URL('web/src/config.ts', root), 'utf8');
const SUPABASE_URL = /https:\/\/[a-z0-9]+\.supabase\.co/.exec(cfg)![0], ANON = /sb_publishable_[A-Za-z0-9_-]+/.exec(cfg)![0];
const url = new URL(readFileSync(new URL('supabase/.temp/pooler-url', root), 'utf8').trim()); url.password = encodeURIComponent(env.SUPABASE_DB_PASSWORD!);
const db = new pg.Client({ connectionString: url.href, ssl: { rejectUnauthorized: false } }); await db.connect();
const EMAIL = 'e2e-delete@evanconcursos.test', PASSWORD = randomBytes(18).toString('base64url');
const ok = (cond: unknown, msg: string) => { console.log(`${cond ? 'ok  ' : 'FALHA'} ${msg}`); if (!cond) process.exitCode = 1; };
const PDF = new TextEncoder().encode('%PDF-1.4\n%%EOF\n');

await db.query(`delete from auth.users where email = $1`, [EMAIL]);
const sb = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
const folders: [string, string][] = [];
const names = async (bucket: string, folder: string) => (await sb.storage.from(bucket).list(folder, { limit: 1000 })).data?.map((f) => f.name) ?? [];
try {
  const { rows: [u] } = await db.query(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
     values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1, extensions.crypt($2, extensions.gen_salt('bf')), now(),
             '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '') returning id`, [EMAIL, PASSWORD]);
  await db.query(`insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), $1::uuid, $2::text, json_build_object('sub', $2::text, 'email', $3::text, 'email_verified', true), 'email', now(), now(), now())`, [u.id, String(u.id), EMAIL]);
  const login = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  ok(!login.error, `login do usuário de teste ${login.error?.message ?? ''}`);

  const one = (s: string, p: unknown[]) => db.query(s, p).then((r) => r.rows[0]);
  const notice = await one(`insert into public.notices (owner_id, title, status) values ($1, 'E2E', 'reviewed') returning id`, [u.id]);
  const plan = await one(`insert into public.study_plans (owner_id, notice_id, name) values ($1, $2, 'E2E') returning id`, [u.id, notice.id]);
  const edital: [string, string] = ['editais', `${u.id}/${notice.id}`], material: [string, string] = ['materiais', `${u.id}/${plan.id}`];
  folders.push(edital, material);
  for (const [bucket, folder] of folders) {
    const up = await sb.storage.from(bucket).upload(`${folder}/a.pdf`, PDF, { contentType: 'application/pdf' });
    ok(!up.error, `PDF enviado em ${bucket} ${up.error?.message ?? ''}`);
  }

  // Mesma sequência de deleteNotice.
  for (const [bucket, folder] of folders) {
    const files = await sb.storage.from(bucket).list(folder, { limit: 1000 });
    ok(files.data?.length === 1, `arquivo listado em ${bucket}`);
    const removed = await sb.storage.from(bucket).remove(files.data!.map((f) => `${folder}/${f.name}`));
    ok(!removed.error && removed.data?.length === 1, `arquivo removido de ${bucket}`);
    ok((await names(bucket, folder)).length === 0, `${bucket} vazio depois`);
  }
  const rpc = await sb.rpc('delete_notice', { p_notice: notice.id, p_law_urns: [] });
  ok(!rpc.error, `delete_notice ${rpc.error?.message ?? ''}`);
  ok((await db.query(`select 1 from public.notices where id = $1`, [notice.id])).rowCount === 0, 'edital apagado');
  ok((await db.query(`select 1 from public.study_plans where id = $1`, [plan.id])).rowCount === 0, 'plano apagado');
} finally {
  for (const [bucket, folder] of folders) {
    const left = await names(bucket, folder);
    if (left.length) await sb.storage.from(bucket).remove(left.map((n) => `${folder}/${n}`));
  }
  await db.query(`delete from auth.users where email = $1`, [EMAIL]);
  await db.end();
}
