// Apaga todas as apostilas guardadas, para serem geradas de novo com as regras atuais (lendo token e projeto do .env).
// Uso: node scripts/clear-guides.mjs        → só mostra quanto há (nada é apagado)
//      node scripts/clear-guides.mjs run    → apaga as apostilas (study_guides), os áudios delas (guide_audio e os
//                                             arquivos do bucket guide-audio) e o histórico de geração (ai_jobs de
//                                             study_guide fora de andamento, que segurava nova tentativa por 24 h)
// Não mexe em dados do estudante: tarefas, revisões, questões e materiais ficam. A apostila volta a ser gerada ao abrir a
// sessão ou no preparo automático da tela Hoje.
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^\s*[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const missing = ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF'].filter((k) => !env[k]);
if (missing.length) {
  console.error(`Preencha no .env: ${missing.join(', ')}`);
  process.exit(1);
}
const REF = env.SUPABASE_PROJECT_REF, MANAGEMENT = `https://api.supabase.com/v1/projects/${REF}`, BUCKET = 'guide-audio';

async function request(url, headers, init = {}) {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status}: ${body.message ?? body.msg ?? body.error ?? 'falha na chamada'}`);
  return body;
}
const management = (path, init) => request(MANAGEMENT + path, { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` }, init);
const sql = (query) => management('/database/query', { method: 'POST', body: JSON.stringify({ query }) });

const counts = async () => (await sql(`select
  (select count(*) from public.study_guides)::int as apostilas,
  (select count(*) from public.guide_audio)::int as audios,
  (select count(*) from public.ai_jobs where kind = 'study_guide' and status <> 'running')::int as geracoes,
  (select count(*) from public.ai_jobs where kind = 'study_guide' and status = 'running')::int as em_andamento`))[0];

const before = await counts();
console.log(`Apostilas: ${before.apostilas} · áudios: ${before.audios} · gerações registradas: ${before.geracoes} · em andamento: ${before.em_andamento}`);
if (process.argv[2] !== 'run') {
  console.log('Nada foi apagado. Para apagar: node scripts/clear-guides.mjs run');
  process.exit(0);
}
if (before.em_andamento) console.log('Há geração em andamento: ela termina e grava a apostila nova normalmente.');

// Arquivos de áudio primeiro: sem a linha da tabela, o caminho deles se perde.
const paths = (await sql('select storage_path from public.guide_audio')).map((r) => r.storage_path).filter(Boolean);
if (paths.length) {
  const keys = await management('/api-keys?reveal=true');
  const key = keys.find((k) => k.name === 'service_role')?.api_key;
  if (!key) throw new Error('Chave service_role não encontrada.');
  for (let i = 0; i < paths.length; i += 100) {
    await request(`https://${REF}.supabase.co/storage/v1/object/${BUCKET}`, { apikey: key, Authorization: `Bearer ${key}` },
      { method: 'DELETE', body: JSON.stringify({ prefixes: paths.slice(i, i + 100) }) });
  }
}
await sql(`begin;
  delete from public.guide_audio;
  delete from public.study_guides;
  delete from public.ai_jobs where kind = 'study_guide' and status <> 'running';
commit;`);
const after = await counts();
console.log(`Apagado: ${before.apostilas - after.apostilas} apostilas, ${before.audios - after.audios} áudios (${paths.length} arquivos), ${before.geracoes - after.geracoes} registros de geração.`);
