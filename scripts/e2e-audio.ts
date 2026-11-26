// Teste ponta a ponta da Edge Function "audio-review" com um usuário temporário (criado e apagado aqui): plano mínimo
// com um tema já estudado (que casa com uma apostila real do banco), revisão semanal hoje, alguns erros. Gera uma
// revisão de 10 min de verdade (custo de IA: cerca de US$ 0,15), confere os blocos, a miniavaliação, o limite e a
// idempotência. Pré-requisito: e2e@evanconcursos.test em ALLOWED_EMAILS.
// Uso: npx tsx scripts/e2e-audio.ts [pasta-para-salvar-os-blocos]
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const root = new URL('..', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('.env', root), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const cfg = readFileSync(new URL('web/src/config.ts', root), 'utf8');
const SUPABASE_URL = /https:\/\/[a-z0-9]+\.supabase\.co/.exec(cfg)![0], ANON = /sb_publishable_[A-Za-z0-9_-]+/.exec(cfg)![0];
const url = new URL(readFileSync(new URL('supabase/.temp/pooler-url', root), 'utf8').trim()); url.password = encodeURIComponent(env.SUPABASE_DB_PASSWORD!);
const db = new pg.Client({ connectionString: url.href, ssl: { rejectUnauthorized: false } }); await db.connect();
const EMAIL = 'e2e@evanconcursos.test', PASSWORD = randomBytes(18).toString('base64url');
const save = process.argv[2];
const ok = (cond: unknown, msg: string) => { console.log(`${cond ? 'ok  ' : 'FALHA'} ${msg}`); if (!cond) process.exitCode = 1; };
const today = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

await db.query(`delete from auth.users where email = $1`, [EMAIL]);
try {
  const { rows: [u] } = await db.query(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
     values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1, extensions.crypt($2, extensions.gen_salt('bf')), now(),
             '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '') returning id`, [EMAIL, PASSWORD]);
  await db.query(`insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), $1::uuid, $2::text, json_build_object('sub', $2::text, 'email', $3::text, 'email_verified', true), 'email', now(), now(), now())`, [u.id, String(u.id), EMAIL]);
  const uid = u.id as string;

  // Plano mínimo: o tema "Atos administrativos" (CEBRASPE) já tem apostila completa no banco.
  const ids = Object.fromEntries(['notice', 'subject', 'topic', 'plan', 'version', 'session', 'theory', 'weekly'].map((k) => [k, crypto.randomUUID()]));
  await db.query(`insert into public.notices (id, owner_id, title, status, board, role_name) values ($1, $2, 'E2E áudio', 'reviewed', 'CEBRASPE', 'Técnico')`, [ids.notice, uid]);
  await db.query(`insert into public.notice_subjects (id, owner_id, notice_id, name) values ($1, $2, $3, 'Noções de Direito Administrativo e Administração Pública')`, [ids.subject, uid, ids.notice]);
  await db.query(`insert into public.notice_topics (id, owner_id, subject_id, text) values ($1, $2, $3, $4)`, [ids.topic, uid, ids.subject,
    '2 Ato administrativo. 2.1 Conceito, requisitos, atributos, classificação e espécies. Extinção. Nulidades e revogação. 2.2 Parecer: responsabilidade do emissor do parecer.']);
  await db.query(`insert into public.study_plans (id, owner_id, notice_id, name) values ($1, $2, $3, 'P')`, [ids.plan, uid, ids.notice]);
  await db.query(`insert into public.plan_versions (id, owner_id, plan_id, number, inputs) values ($1, $2, $3, 1, '{}')`, [ids.version, uid, ids.plan]);
  await db.query(`insert into public.study_sessions (id, owner_id, plan_version_id, subject_id, position, title, topic_ids) values ($1, $2, $3, $4, 1, $5, array[$6::uuid])`,
    [ids.session, uid, ids.version, ids.subject, 'Atos Administrativos: conceito, requisitos, atributos, classificação, espécies, extinção e pareceres', ids.topic]);
  await db.query(`insert into public.tasks (id, owner_id, plan_id, date, kind, title, subject_id, session_id, created_in_version) values
    ($1, $2, $3, $4::date - 6, 'theory', 'Atos Administrativos', $5, $6, $7), ($8, $2, $3, $4::date, 'weekly_review', 'Revisão da semana', null, null, $7)`,
    [ids.theory, uid, ids.plan, today, ids.subject, ids.session, ids.version, ids.weekly]);
  await db.query(`update public.tasks set done_at = now() - interval '6 days' where id = $1`, [ids.theory]);
  await db.query(`update public.theory_reviews set due_on = $2::date where owner_id = $1`, [uid, today]);
  // Desempenho: 6 questões da sessão, 4 erradas (o tema vira "erros", com dado suficiente).
  const { rows: qs } = await db.query(`select qid, materia, assunto from public.qbank_questions where materia ilike '%administrativo%' limit 6`);
  for (const [i, q] of qs.entries()) {
    await db.query(`insert into public.question_attempts (owner_id, plan_id, task_id, session_id, subject_id, qid, materia, assunto, chosen, correct) values ($1, $2, $3, $4, $5, $6, $7, $8, 'A', $9)`,
      [uid, ids.plan, ids.theory, ids.session, ids.subject, q.qid, q.materia, q.assunto, i >= 4]);
  }

  const auth = await (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).json() as { access_token?: string };
  ok(auth.access_token, 'login do usuário de teste');
  const call = async (body: Record<string, unknown>) => {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/audio-review`, { method: 'POST', headers: { Authorization: `Bearer ${auth.access_token}`, apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, data: await r.json() as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  ok((await call({ action: 'start', taskId: ids.theory, duration: 10, voice: 'feminina' })).status === 400, 'tarefa que não é revisão semanal é recusada');
  const t0 = Date.now();
  const start = await call({ action: 'start', taskId: ids.weekly, duration: 10, voice: 'masculina' });
  ok(start.status === 200 && start.data.review?.id, `começa (${start.data.review?.status ?? start.data.error})`);
  const id = start.data.review.id as string;
  const again = await call({ action: 'start', taskId: ids.weekly, duration: 10, voice: 'masculina' });
  ok(again.data.review?.id === id, 'mesmo pedido devolve a mesma revisão (idempotente)');
  const other = await call({ action: 'start', taskId: ids.weekly, duration: 20, voice: 'feminina' });
  ok(other.status === 403 && other.data.code === 'limit', 'outra configuração na mesma semana bate no limite');

  let last = '', review: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  while (Date.now() - t0 < 12 * 60_000) {
    review = (await call({ action: 'status', taskId: ids.weekly })).data.review;
    const label = `${review.status}${review.blocks ? ` ${review.blocks.done}/${review.blocks.total}` : ''}`;
    if (label !== last) { console.log(`     ${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s  ${label}`); last = label; }
    if (review.status === 'ready' || review.status === 'failed') break;
    await new Promise((r) => setTimeout(r, 4000));
  }
  ok(review.status === 'ready', `fica pronta em ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (review.status === 'failed') {
    const { rows: [f] } = await db.query(`select error, issues from public.audio_reviews where id = $1`, [id]);
    console.log('     erro:', f.error);
  }
  if (review.status === 'ready') {
    ok(review.timeline?.chapters?.length >= 2, `capítulos: ${review.timeline.chapters.map((c: { titulo: string }) => c.titulo).join(' | ')}`);
    ok(review.durationMs > 4 * 60_000, `duração ${(review.durationMs / 60000).toFixed(1)} min (pedido: 10)`);
    ok(review.themes?.[0]?.reasons?.some((r: string) => r.includes('errou 4 de 6')), `motivos reais: ${review.themes?.[0]?.reasons?.join('; ')}`);
    const links = await call({ action: 'links', id });
    ok(links.data.blocks?.length === review.timeline.blocks.length, `links de ${links.data.blocks?.length} blocos`);
    let bytes = 0;
    if (save) mkdirSync(save, { recursive: true });
    for (const b of links.data.blocks ?? []) {
      const buf = new Uint8Array(await (await fetch(b.url)).arrayBuffer());
      bytes += buf.length;
      if (save) writeFileSync(join(save, `bloco-${String(b.index).padStart(2, '0')}.mp3`), buf);
      if (!(buf.length > 1000 && (buf[0] === 0xff || (buf[0] === 0x49 && buf[1] === 0x44)))) ok(false, `bloco ${b.index} não parece MP3`);
    }
    ok(bytes > 0, `narração baixada: ${(bytes / 1e6).toFixed(1)} MB`);
    if (save) writeFileSync(join(save, 'timeline.json'), JSON.stringify(review.timeline, null, 1));
    // Outro estudante (sem login) não lê os links.
    ok((await fetch(`${SUPABASE_URL}/functions/v1/audio-review`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'links', id }) })).status === 401, 'sem login não pega links');
    let quiz = review.quiz;
    for (let i = 0; !quiz && i < 15; i++) { await new Promise((r) => setTimeout(r, 4000)); quiz = (await call({ action: 'status', taskId: ids.weekly })).data.review.quiz; }
    ok(quiz?.length >= 3 && !('correta' in quiz[0]), `miniavaliação com ${quiz?.length} questões, sem gabarito na tela`);
    if (quiz?.length) {
      const res = await call({ action: 'quiz', id, answers: quiz.map(() => 0) });
      ok(Number.isInteger(res.data.score) && res.data.correct?.length === quiz.length, `correção no servidor: ${res.data.score} de ${res.data.total}`);
      const again2 = await call({ action: 'quiz', id, answers: quiz.map(() => 1) });
      ok(again2.data.score === res.data.score, 'segunda resposta não muda a nota');
    }
    await call({ action: 'progress', id, positionMs: 60_000, listenedMs: 61_000, music: true, speed: 1.25 });
    const { rows: [p] } = await db.query(`select position_ms, listened_ms, music, speed, cost_usd, usage from public.audio_reviews where id = $1`, [id]);
    ok(p.position_ms === 60000 && p.music === true && Number(p.speed) === 1.25, 'progresso gravado');
    console.log(`     custo registrado: US$ ${p.cost_usd} · ${JSON.stringify(p.usage)}`);
  }
} finally {
  await db.query(`delete from auth.users where email = $1`, [EMAIL]);
  await db.end();
}
