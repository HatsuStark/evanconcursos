// Carga de revisão por conta, só leitura: o que vence hoje em cada fila (temas de teoria, caderno de erros, flashcards e
// conceitos da Aula guiada), quanto passou de 7 dias, o maior atraso, o ritmo dos últimos 14 dias, as revisões semanais
// das últimas 4 semanas e os dias com questões. Contas aparecem pelo início do md5 do e-mail.
// Uso: node scripts/review-load.mjs
// Base de comparação (2026-11-22, antes da revisão sem acúmulo): conta mais ativa com 18 temas, 10 erros, 20 flashcards
// e 11 conceitos vencidos (~1h45); teoria entrando 1,2–1,8 temas/dia e saindo 0,4–0,9; revisão semanal feita 0–1 vez.
import { readFileSync } from 'node:fs';
import pg from 'pg';

const root = new URL('..', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('.env', root), 'utf8').split(/\r?\n/).filter((l) => /^\s*[A-Z_]+=/.test(l))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const url = new URL(readFileSync(new URL('supabase/.temp/pooler-url', root), 'utf8').trim());
url.password = encodeURIComponent(env.SUPABASE_DB_PASSWORD);

const T = "(now() at time zone 'America/Sao_Paulo')::date";
const QUERIES = {
  temas: `select owner_id, count(*) filter (where due_on<=${T}) vencem, count(*) filter (where due_on<${T}-7) mais_de_7d, max(${T}-due_on) filter (where due_on<=${T}) maior_atraso,
    count(*) filter (where last_reviewed_at>now()-interval '14 days') revisados_14d, count(*) filter (where created_at>now()-interval '14 days') novos_14d
    from public.theory_reviews where status='pending' or last_reviewed_at>now()-interval '14 days' group by 1`,
  erros: `select owner_id, count(*) filter (where not resolved and due_on<=${T}) vencem, count(*) filter (where not resolved and due_on<${T}-7) mais_de_7d,
    max(${T}-due_on) filter (where not resolved and due_on<=${T}) maior_atraso, count(*) filter (where not resolved) abertos from public.error_book group by 1`,
  flashcards: `select owner_id, count(*) filter (where due_on<=${T}) vencem, count(*) filter (where due_on<${T}-7) mais_de_7d, count(*) total from public.flashcards group by 1`,
  conceitos: `select owner_id, count(*) filter (where due_on<=${T}) vencem, count(*) filter (where due_on<${T}-7) mais_de_7d, count(*) total, sum(reviews) revisoes from public.tutor_concepts group by 1`,
  semanal_4sem: `select owner_id, count(*) filter (where date<=${T}) passaram, count(*) filter (where date<=${T} and done_at is not null) feitas, min(date) filter (where date>${T}) proxima
    from public.tasks where kind='weekly_review' and superseded_in_version is null and date>${T}-28 group by 1`,
  dias_com_questoes_14d: `select owner_id, count(distinct (created_at at time zone 'America/Sao_Paulo')::date) dias from public.question_attempts where created_at>now()-interval '14 days' group by 1`,
};

const db = new pg.Client({ connectionString: url.href, ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  const ids = Object.fromEntries((await db.query(`select id, left(md5(email), 6) conta from auth.users`)).rows.map((r) => [r.id, r.conta]));
  for (const [name, sql] of Object.entries(QUERIES)) {
    console.log(`\n## ${name}`);
    const { rows } = await db.query(sql);
    for (const { owner_id, ...rest } of rows) {
      const vals = Object.entries(rest).map(([k, v]) => `${k}=${v instanceof Date ? v.toISOString().slice(0, 10) : v ?? '-'}`).join(' ');
      console.log(`${ids[owner_id] ?? owner_id.slice(0, 6)}  ${vals}`);
    }
  }
} finally {
  await db.end();
}
