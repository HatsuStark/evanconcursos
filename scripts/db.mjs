// Banco do projeto Supabase, lendo token e senha do .env (nada é impresso).
// Uso: node scripts/db.mjs push   → aplica as migrações de supabase/migrations
//      node scripts/db.mjs test   → roda os testes pgTAP de supabase/tests (transação desfeita no fim)
//      node scripts/db.mjs dry    → mostra as migrações que seriam aplicadas
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const CLI = 'supabase@2.120.0';
const root = new URL('..', import.meta.url);
const env = Object.fromEntries(
  readFileSync(new URL('.env', root), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^\s*[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const missing = ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF', 'SUPABASE_DB_PASSWORD'].filter((k) => !env[k]);
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
    // A CLI lê o token e a senha do banco destas variáveis.
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: env.SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD: env.SUPABASE_DB_PASSWORD },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

// Testes pgTAP sem Docker (o `supabase test db` exige Docker): cada arquivo roda numa conexão ao
// pooler (modo sessão) e imprime a saída TAP. Os arquivos fazem begin/rollback, então nada fica gravado.
async function test() {
  const { default: pg } = await import('pg');
  const { readdirSync } = await import('node:fs');
  const pooler = new URL(readFileSync(new URL('supabase/.temp/pooler-url', root), 'utf8').trim());
  pooler.password = encodeURIComponent(env.SUPABASE_DB_PASSWORD);
  const dir = new URL('supabase/tests/database/', root);
  let failed = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.test.sql')).sort()) {
    const client = new pg.Client({ connectionString: pooler.href, ssl: { rejectUnauthorized: false } });
    await client.connect();
    console.log(`# ${file}`);
    try {
      const results = [].concat(await client.query(readFileSync(new URL(file, dir), 'utf8')));
      const lines = results.flatMap((r) => r.rows ?? []).map((row) => Object.values(row)[0])
        .filter((v) => typeof v === 'string' && /^(ok|not ok|#|1\.\.)/.test(v));
      for (const l of lines) console.log(l);
      failed += lines.filter((l) => l.startsWith('not ok') || /^# Looks like you failed/.test(l)).length;
      if (!lines.some((l) => l.startsWith('1..'))) { console.log('not ok - o arquivo não chegou ao finish()'); failed++; }
    } catch (e) {
      console.log(`not ok - erro: ${e.message}`);
      failed++;
      await client.query('rollback').catch(() => {});
    } finally {
      await client.end();
    }
  }
  console.log(failed ? `\nFALHOU: ${failed}` : '\nTodos os testes passaram.');
  process.exit(failed ? 1 : 0);
}

const cmd = process.argv[2];
run(['link', '--project-ref', env.SUPABASE_PROJECT_REF]);
if (cmd === 'push') run(['db', 'push', '--linked']);
else if (cmd === 'dry') run(['db', 'push', '--linked', '--dry-run']);
else if (cmd === 'test') await test();
else {
  console.error('Uso: node scripts/db.mjs push | dry | test');
  process.exit(1);
}
