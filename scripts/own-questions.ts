// Importa o banco próprio (projeto apiQuestoes) para qbank_questions, pela conexão direta ao Postgres. As questões entram
// com id "own-…" e passam a ser servidas pelo cache antes da Quest API (sem créditos). Reimportar atualiza o conteúdo;
// a explicação da IA só é descartada se o gabarito mudou.
// Questão repetida (cargos do mesmo concurso dividem blocos de questões; mesmo enunciado e alternativas no mesmo concurso,
// ou também o mesmo texto-base entre concursos) entra uma vez só: fica a primeira na ordem dos arquivos.
// Uso: node --experimental-strip-types scripts/own-questions.ts [--dir <pasta _aceitas>] [--dry] [--remover] [--limpar-repetidas]
//   --dir      padrão: ../apiQuestoes/Provas/_aceitas e ../apiQuestoes/Provas/_soltas (ou OWN_QUESTIONS_DIR no .env)
//              _soltas: provas montadas com questões soltas (npm run soltas no apiQuestoes); _aceitas vem antes, então
//              questão que também está numa prova completa fica com o id da completa
//   --dry      só conta o que entraria, sem gravar
//   --remover  apaga todas as questões próprias (respostas, caderno de erros e anotações delas ficam órfãs)
//   --limpar-repetidas  apaga do banco as repetidas importadas antes desta regra; tentativas e caderno de erros delas passam
//              para a questão que fica (anotações e comentários ficariam órfãos: a contagem aparece antes)
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
const rows: OwnRow[] = [], dropped: string[] = [], skipped: Record<string, number> = {}, materias: Record<string, number> = {};
let exams = 0, total = 0;
for (const file of files) {
  const exam = JSON.parse(readFileSync(file, 'utf8')) as OwnExam;
  if (!Array.isArray(exam.questoes) || !exam.prova) continue;
  exams++; total += exam.questoes.length;
  const key = basename(file, '.json');
  const r = ownRows(exam, (n) => ownQid(sha1, key, n));
  rows.push(...r.rows);
  dropped.push(...r.dropped);
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
// Duas chaves: (1) enunciado, alternativas e começo do texto-base, entre concursos; (2) no mesmo concurso (banca, órgão e
// ano), só enunciado e alternativas: cada cargo transcreve o texto-base (descrição da tirinha, da imagem) de um jeito, e a
// chave 1 deixava a mesma questão entrar uma vez por cargo. Questões com qualquer chave em comum são a mesma.
const group = new Map<string, string>(), keyOf = new Map<OwnRow, string>();
const find = (k: string): string => { const p = group.get(k) ?? k; if (p === k) return k; const root = find(p); group.set(k, root); return root; };
for (const r of rows) {
  const body = `${plain(r.payload.enunciado)}|${r.payload.alternativas.map((a) => plain(a.texto)).join('|')}`;
  const k1 = sha1(`${body}|${plain(r.payload.textos[0] ?? '').slice(0, 300)}`);
  const k2 = sha1(`${plain(`${r.payload.prova.banca}|${r.payload.prova.orgao}|${r.payload.prova.ano}`)}|${body}`);
  const a = find(k1), b = find(k2);
  if (a !== b) group.set(b, a);
  keyOf.set(r, k1);
}
const winner = new Map<string, OwnRow>();
for (const r of rows) {
  const k = find(keyOf.get(r)!);
  keyOf.set(r, k);
  const w = winner.get(k);
  if (!w || (!noBanco.has(w.qid) && noBanco.has(r.qid))) winner.set(k, r);
}
const repeated = rows.filter((r) => winner.get(keyOf.get(r)!) !== r).map((r) => r.qid);
const repeatedPairs = rows.filter((r) => winner.get(keyOf.get(r)!) !== r).map((r) => [r.qid, winner.get(keyOf.get(r)!)!.qid] as const);
const unique = rows.filter((r) => winner.get(keyOf.get(r)!) === r);
rows.length = 0; rows.push(...unique);
if (repeated.length) skipped['repetida'] = repeated.length;
for (const r of rows) materias[r.materia] = (materias[r.materia] ?? 0) + 1;
console.log(`${exams} provas, ${total} questões: ${rows.length} aproveitadas; fora: ${JSON.stringify(skipped)}`);
console.log('Por matéria:', Object.entries(materias).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([m, n]) => `${m} ${n}`).join(' · '));
// Com --limpar-repetidas, mostra quanto do que o estudante fez está nas repetidas que sairiam.
if (CLEAN && repeated.length) {
  try {
    const db = await connect();
    const used = await Promise.all(['question_attempts', 'error_book', 'question_notes', 'question_comments', 'simulado_answers'].map(async (t) => {
      const { rows: [c] } = await db.query(`select count(*)::int n from public.${t} where qid = any($1::text[])`, [repeated]);
      return `${t} ${c.n}`;
    }));
    console.log(`Atividade nas ${repeated.length} repetidas: ${used.join(' · ')}`);
    await db.end();
  } catch (e) { console.log(`(sem contagem de atividade: ${(e as Error).message})`); }
}
if (DRY || !rows.length) process.exit(0);

const db = await connect();
// Sem texto-base (ver citesMissingText): saem do banco mesmo se entraram antes da regra. Mesma ressalva das órfãs.
if (dropped.length) {
  const r = await db.query(`delete from public.qbank_questions where qid = any($1::text[])`, [dropped]);
  if (r.rowCount) console.log(`${r.rowCount} questões sem texto-base removidas do banco.`);
}
if (CLEAN && repeated.length) {
  // Tentativas e caderno de erros da repetida passam para a que fica (no caderno, se o estudante já tem a que fica, vale ela).
  const pairs = repeatedPairs;
  if (pairs.length) {
    const map = JSON.stringify(pairs.map(([from, to]) => ({ from, to })));
    const m = `jsonb_to_recordset($1::jsonb) as m("from" text, "to" text)`;
    const a = await db.query(`update public.question_attempts t set qid = m."to" from ${m} where t.qid = m."from"`, [map]);
    const e = await db.query(`update public.error_book t set qid = m."to" from ${m} where t.qid = m."from"
      and not exists (select 1 from public.error_book o where o.owner_id = t.owner_id and o.plan_id is not distinct from t.plan_id and o.qid = m."to")`, [map]);
    if (a.rowCount || e.rowCount) console.log(`Movidas para a questão que fica: ${a.rowCount} tentativas, ${e.rowCount} do caderno de erros.`);
  }
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
// Retrato do banco próprio no painel do admin (leva uns 20 s).
await db.query('select public.admin_refresh_own_bank()').then(() => console.log('Painel do admin atualizado.'), (e) => console.log(`Painel do admin não atualizado: ${(e as Error).message}`));
await db.end();
