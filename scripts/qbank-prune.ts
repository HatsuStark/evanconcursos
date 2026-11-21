// Questões do banco que o app nunca mostra: citam um texto que não veio (ou só a fonte dele) ou falam em termo destacado
// sem nada marcado. As buscas já as filtram; este script as conta e, com --apagar, tira do banco.
// Uso: npx tsx scripts/qbank-prune.ts [--apagar] [--todas]
//   sem --todas, só as do banco próprio ("own-…"); com --todas, também as guardadas da Quest (voltam se forem compradas
//   de novo, e o filtro as barra outra vez).
// As tentativas dos estudantes (question_attempts) ficam: só a questão sai.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { lacksMark, lacksText, OWN_PREFIX } from '../shared/qbank/own.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const env = Object.fromEntries(readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const APPLY = process.argv.includes('--apagar'), ALL = process.argv.includes('--todas');

const url = new URL(readFileSync(join(root, 'supabase', '.temp', 'pooler-url'), 'utf8').trim());
url.password = encodeURIComponent(env.SUPABASE_DB_PASSWORD!);
const db = new pg.Client({ connectionString: url.href, ssl: { rejectUnauthorized: false } });
await db.connect();

const blocked: { qid: string; why: string; materia: string }[] = [];
// O banco separa os candidatos e só eles vêm pela rede (a conexão é lenta para os 200 MB): sem anexo e, para "sem texto",
// matéria de leitura sem nenhum texto longo (texto longo nunca é só a fonte); para "sem destaque", comando que fala em
// destacado. As regras exatas (lacksText, lacksMark) rodam aqui. Primeiro só os ids, depois o payload pela chave.
const ids: string[] = (await db.query(`
  select qid from public.qbank_questions
  where qid not like 'ia-%' ${ALL ? '' : 'and qid like $1'}
    and coalesce(jsonb_array_length(payload->'anexos'), 0) = 0
    and ((materia ~* 'portuguesa|interpreta|literatura|reda[cç][aã]o'
          and not exists (select 1 from jsonb_array_elements_text(coalesce(payload->'textos', '[]'::jsonb)) t where length(t) >= 600))
      or payload->>'enunciado' ~* 'destacad|em destaque|sublinhad|em negrito|grifad')`,
  ALL ? [] : [`${OWN_PREFIX}%`])).rows.map((r) => r.qid);
console.log(`Candidatas: ${ids.length}.`);
let scanned = 0;
for (let i = 0; i < ids.length; i += 500) {
  const { rows } = await db.query('select qid, materia, payload from public.qbank_questions where qid = any($1::text[])', [ids.slice(i, i + 500)]);
  for (const r of rows) {
    const why = lacksText(r.payload) ? 'sem texto' : lacksMark(r.payload) ? 'sem destaque' : '';
    if (why) blocked.push({ qid: r.qid, why, materia: r.materia });
  }
  scanned += rows.length;
}

const count = (key: (b: (typeof blocked)[number]) => string) => blocked.reduce<Record<string, number>>((m, b) => ((m[key(b)] = (m[key(b)] ?? 0) + 1), m), {});
console.log(`Lidas: ${scanned}. Bloqueadas: ${blocked.length}.`);
console.log('Por fonte:', count((b) => (b.qid.startsWith(OWN_PREFIX) ? 'própria' : 'Quest')));
console.log('Por motivo:', count((b) => b.why));
console.log('Por matéria:', count((b) => b.materia));
const qids = blocked.map((b) => b.qid);
if (qids.length) {
  const { rows } = await db.query('select count(distinct qid)::int as n, count(*)::int as t from public.question_attempts where qid = any($1::text[])', [qids]);
  console.log(`Já respondidas: ${rows[0].n} questões (${rows[0].t} tentativas, que ficam guardadas).`);
}
if (APPLY && qids.length) {
  const r = await db.query('delete from public.qbank_questions where qid = any($1::text[])', [qids]);
  console.log(`Apagadas: ${r.rowCount}.`);
} else if (qids.length) console.log('Nada apagado (rode com --apagar).');
await db.end();
