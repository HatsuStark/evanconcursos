// Importa o banco próprio (projeto apiQuestoes) para qbank_questions, pela conexão direta ao Postgres. As questões entram
// com id "own-…" e passam a ser servidas pelo cache antes da Quest API (sem créditos). Reimportar atualiza o conteúdo;
// a explicação da IA só é descartada se o gabarito mudou.
// Questão repetida (cargos do mesmo concurso dividem blocos de questões; mesmo enunciado, alternativas e texto-base) entra
// uma vez só: fica a primeira na ordem dos arquivos.
// Uso: node --experimental-strip-types scripts/own-questions.ts [--dir <pasta _aceitas>] [--dry] [--remover] [--limpar-repetidas]
//   --dir      padrão: ../apiQuestoes/Provas/_aceitas e ../apiQuestoes/Provas/_soltas (ou OWN_QUESTIONS_DIR no .env)
//              _soltas: provas montadas com questões soltas (npm run soltas no apiQuestoes); _aceitas vem antes, então
//              questão que também está numa prova completa fica com o id da completa
//   --dry      só conta o que entraria, sem gravar
//   --remover  apaga todas as questões próprias (respostas, caderno de erros e anotações delas ficam órfãs)
//   --limpar-repetidas  apaga do banco as repetidas importadas antes desta regra (mesma ressalva das órfãs)
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { OWN_PREFIX, ownQid, ownRows, type OwnExam, type OwnRow } from '../shared/qbank/own.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const env = Object.fromEntries(readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const DRY = args.includes('--dry'), REMOVE = args.includes('--remover'), CLEAN = args.includes('--limpar-repetidas');
const provas = join(root, '..', 'apiQuestoes', 'Provas');
const dirs = (opt('--dir') ?? env.OWN_QUESTIONS_DIR) ? [resolve((opt('--dir') ?? env.OWN_QUESTIONS_DIR)!)] : [join(provas, '_aceitas'), join(provas, '_soltas')];

async function connect() {
  const url = new URL(readFileSync(join(root, 'supabase', '.temp', 'pooler-url'), 'utf8').trim());
  url.password = encodeURIComponent(env.SUPABASE_DB_PASSWORD!);
  const db = new pg.Client({ connectionString: url.href, ssl: { rejectUnauthorized: false } });
  await db.connect();
  return db;
}

if (REMOVE) {
  const db = await connect();
  const r = await db.query(`delete from public.qbank_questions where qid like $1`, [`${OWN_PREFIX}%`]);
  console.log(`${r.rowCount} questões próprias removidas.`);
  await db.end();
  process.exit(0);
}

if (!existsSync(dirs[0])) throw new Error(`Pasta não encontrada: ${dirs[0]}`);
const files: string[] = [];
// _entrada (dentro de _soltas) é a matéria-prima das provas soltas, não prova.
const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== '_entrada') walk(p); } else if (f.endsWith('.json')) files.push(p); } };
for (const d of dirs) if (existsSync(d)) walk(d);

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');
const rows: OwnRow[] = [], skipped: Record<string, number> = {}, materias: Record<string, number> = {};
let exams = 0, total = 0;
for (const file of files) {
  const exam = JSON.parse(readFileSync(file, 'utf8')) as OwnExam;
  if (!Array.isArray(exam.questoes) || !exam.prova) continue;
  exams++; total += exam.questoes.length;
  const key = basename(file, '.json');
  const r = ownRows(exam, (n) => ownQid(sha1, key, n));
  rows.push(...r.rows);
  for (const [k, v] of Object.entries(r.skipped)) skipped[k] = (skipped[k] ?? 0) + v;
}
// Repetidas: mesma chave de conteúdo (texto sem formatação, acento nem pontuação). Fica a que já está no banco (o id que
// os alunos já usaram: histórico, caderno de erros), senão a primeira (_aceitas antes de _soltas). Sem isso, questão solta
// importada antes da prova completa viraria linha sobrando quando a completa chegasse.
const plain = (s: string) => s.replace(/<[^>]+>/g, '').normalize('NFD').replace(/[^a-z0-9]/gi, '').toLowerCase();
let noBanco = new Set<string>();
try {
  const db = await connect();
  const { rows: r } = await db.query(`select qid from public.qbank_questions where qid like $1`, [`${OWN_PREFIX}%`]);
  noBanco = new Set((r as { qid: string }[]).map((x) => x.qid));
  await db.end();
} catch (e) {
  if (!DRY) throw e;
  console.log(`(--dry sem banco: ${(e as Error).message}; repetidas ficam com a primeira)`);
}
const winner = new Map<string, OwnRow>(), keyOf = new Map<OwnRow, string>();
for (const r of rows) {
  const k = sha1(`${plain(r.payload.enunciado)}|${r.payload.alternativas.map((a) => plain(a.texto)).join('|')}|${plain(r.payload.textos[0] ?? '').slice(0, 300)}`);
  keyOf.set(r, k);
  const w = winner.get(k);
  if (!w || (!noBanco.has(w.qid) && noBanco.has(r.qid))) winner.set(k, r);
}
const repeated = rows.filter((r) => winner.get(keyOf.get(r)!) !== r).map((r) => r.qid);
const unique = rows.filter((r) => winner.get(keyOf.get(r)!) === r);
rows.length = 0; rows.push(...unique);
if (repeated.length) skipped['repetida'] = repeated.length;
for (const r of rows) materias[r.materia] = (materias[r.materia] ?? 0) + 1;
console.log(`${exams} provas, ${total} questões: ${rows.length} aproveitadas; fora: ${JSON.stringify(skipped)}`);
console.log('Por matéria:', Object.entries(materias).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([m, n]) => `${m} ${n}`).join(' · '));
if (DRY || !rows.length) process.exit(0);

const db = await connect();
if (CLEAN && repeated.length) {
  const r = await db.query(`delete from public.qbank_questions where qid = any($1::text[])`, [repeated]);
  console.log(`${r.rowCount} repetidas removidas do banco.`);
}
const BATCH = 500;
for (let i = 0; i < rows.length; i += BATCH) {
  const chunk = rows.slice(i, i + BATCH);
  await db.query(`
    insert into public.qbank_questions (qid, materia, assunto, payload, gabarito)
    select qid, materia, assunto, payload, gabarito from jsonb_to_recordset($1::jsonb) as x(qid text, materia text, assunto text, payload jsonb, gabarito text)
    on conflict (qid) do update set materia = excluded.materia, assunto = excluded.assunto, payload = excluded.payload, gabarito = excluded.gabarito,
      explanation = case when qbank_questions.gabarito = excluded.gabarito then qbank_questions.explanation end,
      explanation_model = case when qbank_questions.gabarito = excluded.gabarito then qbank_questions.explanation_model end`,
    [JSON.stringify(chunk)]);
  process.stdout.write(`\r${Math.min(i + BATCH, rows.length)}/${rows.length}`);
}
const { rows: [count] } = await db.query(`select count(*)::int as n from public.qbank_questions where qid like $1`, [`${OWN_PREFIX}%`]);
console.log(`\nNo banco: ${count.n} questões próprias.`);
await db.end();
