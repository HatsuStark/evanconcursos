// Publica as Edge Functions de IA no Supabase e grava os segredos delas, lendo tudo do .env.
// Uso: node scripts/deploy-functions.mjs
// Os segredos vão por arquivo temporário (apagado no fim), nunca aparecem no terminal.
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = 'supabase@2.120.0';
const FUNCTIONS = ['notice-extract', 'plan-design', 'legal-text', 'questions', 'study-guide', 'material-map'];
const root = new URL('..', import.meta.url);
const env = Object.fromEntries(
  readFileSync(new URL('.env', root), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^\s*[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const missing = ['GEMINI_API_KEY', 'ALLOWED_EMAILS', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF'].filter((k) => !env[k]);
if (missing.length) {
  console.error(`Preencha no .env: ${missing.join(', ')}`);
  process.exit(1);
}

const run = (args) => {
  console.log(`> supabase ${args.join(' ')}`);
  const r = spawnSync('npx', ['--yes', CLI, ...args], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: env.SUPABASE_ACCESS_TOKEN },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const dir = mkdtempSync(join(tmpdir(), 'evan-secrets-'));
const secretsFile = join(dir, 'secrets.env');
try {
  writeFileSync(
    secretsFile,
    ['GEMINI_API_KEY', 'GEMINI_MODEL', 'ALLOWED_EMAILS', 'QUEST_API_KEY'].filter((k) => env[k]).map((k) => `${k}=${env[k]}`).join('\n'),
  );
  run(['secrets', 'set', '--env-file', secretsFile, '--project-ref', env.SUPABASE_PROJECT_REF]);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
// As funções validam o login do usuário por conta própria (getUser + lista de e-mails).
for (const name of FUNCTIONS) run(['functions', 'deploy', name, '--project-ref', env.SUPABASE_PROJECT_REF, '--no-verify-jwt', '--use-api']);
console.log(`\nPronto: funções publicadas (${FUNCTIONS.join(', ')}).`);
