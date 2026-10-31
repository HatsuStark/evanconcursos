// Contas de convidados, lendo token e projeto do .env. O cadastro público fica desligado: só entra quem está aqui.
// Uso: node scripts/users.mjs add <email>     → cria a conta (ou gera nova senha) e libera o e-mail em ALLOWED_EMAILS
//      node scripts/users.mjs reset <email>   → gera nova senha temporária (senha esquecida)
//      node scripts/users.mjs remove <email>  → encerra o acesso (bloqueia a conta, sem apagar os dados)
//      node scripts/users.mjs list            → contas, último acesso e gasto de IA em 30 dias
// A senha temporária aparece só neste terminal: envie por um canal privado. A troca é obrigatória no primeiro acesso.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = 'supabase@2.120.0';
const envUrl = new URL('../.env', import.meta.url);
const readEnv = () => Object.fromEntries(
  readFileSync(envUrl, 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^\s*[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const env = readEnv();
const missing = ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF'].filter((k) => !env[k]);
if (missing.length) {
  console.error(`Preencha no .env: ${missing.join(', ')}`);
  process.exit(1);
}
const REF = env.SUPABASE_PROJECT_REF, MANAGEMENT = `https://api.supabase.com/v1/projects/${REF}`, AUTH = `https://${REF}.supabase.co/auth/v1/admin`;
const BAN_FOREVER = '876000h';

async function request(url, headers, init = {}) {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status}: ${body.message ?? body.msg ?? body.error_description ?? 'falha na chamada'}`);
  return body;
}
const management = (path, init) => request(MANAGEMENT + path, { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` }, init);
const sql = (query) => management('/database/query', { method: 'POST', body: JSON.stringify({ query }) });

async function authClient() {
  const keys = await management('/api-keys?reveal=true');
  const key = keys.find((k) => k.name === 'service_role')?.api_key;
  if (!key) throw new Error('Chave service_role não encontrada.');
  return (path, init) => request(AUTH + path, { apikey: key, Authorization: `Bearer ${key}` }, init);
}
async function findUser(auth, email) {
  for (let page = 1; ; page++) {
    const { users } = await auth(`/users?page=${page}&per_page=200`);
    const hit = users.find((u) => u.email?.toLowerCase() === email);
    if (hit || users.length < 200) return hit ?? null;
  }
}

// Mantém o .env e o segredo das funções iguais. O e-mail vai por arquivo temporário, como em deploy-functions.mjs.
function setAllowed(change) {
  const current = (readEnv().ALLOWED_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  const next = [...new Set(change(current))];
  const text = readFileSync(envUrl, 'utf8');
  const line = `ALLOWED_EMAILS=${next.join(',')}`;
  writeFileSync(envUrl, /^\s*ALLOWED_EMAILS=.*$/m.test(text) ? text.replace(/^\s*ALLOWED_EMAILS=.*$/m, line) : `${text.trimEnd()}\n${line}\n`);
  const dir = mkdtempSync(join(tmpdir(), 'evan-secrets-'));
  const file = join(dir, 'secrets.env');
  try {
    writeFileSync(file, line);
    const r = spawnSync('npx', ['--yes', CLI, 'secrets', 'set', '--env-file', file, '--project-ref', REF], {
      stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32',
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: env.SUPABASE_ACCESS_TOKEN },
    });
    if (r.status !== 0) throw new Error('Não foi possível atualizar ALLOWED_EMAILS nas funções.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const tempPassword = () => randomBytes(12).toString('base64url');
function showPassword(email, password) {
  console.log(`\nE-mail: ${email}\nSenha temporária: ${password}\n\nEnvie por um canal privado. A pessoa troca a senha no primeiro acesso.`);
}

const [cmd, rawEmail] = process.argv.slice(2);
const email = rawEmail?.trim().toLowerCase();
if (cmd !== 'list' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email ?? '')) {
  console.error('Uso: node scripts/users.mjs add|reset|remove <email> | list');
  process.exit(1);
}

try {
  if (cmd === 'list') {
    const rows = await sql(`select u.email, u.last_sign_in_at::date as last_sign_in, u.banned_until is not null and u.banned_until > now() as blocked,
        coalesce((select round(sum(a.cost_usd), 3) from public.ai_usage a where a.owner_id = u.id and a.created_at > now() - interval '30 days'), 0) as usd_30d
      from auth.users u order by u.created_at`);
    console.table(rows);
  } else if (cmd === 'add' || cmd === 'reset') {
    const auth = await authClient();
    const user = await findUser(auth, email);
    if (cmd === 'reset' && !user) throw new Error('Conta não encontrada. Use add.');
    const password = tempPassword();
    const fields = { password, user_metadata: { must_change_password: true } };
    if (user) await auth(`/users/${user.id}`, { method: 'PUT', body: JSON.stringify({ ...fields, ban_duration: 'none' }) });
    else await auth('/users', { method: 'POST', body: JSON.stringify({ ...fields, email, email_confirm: true }) });
    if (cmd === 'add') setAllowed((list) => [...list, email]);
    showPassword(email, password);
  } else if (cmd === 'remove') {
    const auth = await authClient();
    const user = await findUser(auth, email);
    if (user) await auth(`/users/${user.id}`, { method: 'PUT', body: JSON.stringify({ ban_duration: BAN_FOREVER }) });
    setAllowed((list) => list.filter((e) => e !== email));
    console.log(`Acesso de ${email} encerrado. Os dados continuam no banco; add libera de novo.`);
  } else {
    console.error('Uso: node scripts/users.mjs add|reset|remove <email> | list');
    process.exit(1);
  }
} catch (e) {
  console.error(`Erro: ${e.message}`);
  process.exit(1);
}
