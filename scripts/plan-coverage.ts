// Confere os planos ativos: artigos que o edital pede (faixas citadas, ou a lei toda quando o tópico é só a lei) e que
// nenhuma sessão cobre. Com --aplicar, cada faixa entra na sessão mais próxima da mesma lei ainda não estudada (título,
// law_refs, tópicos e o título das tarefas pendentes), sem mudar datas, e o estudante recebe um aviso (plan_notices)
// dizendo onde mudou. Mesma regra da montagem de planos novos (shared/ai/plan-coverage.ts).
// Uso: node --experimental-strip-types scripts/plan-coverage.ts [--aplicar] [--email <e-mail>]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { articleGaps, fillArticleGaps, lawCite, requiredLaws, type LawArticle } from '../shared/ai/plan-coverage.ts';
import { DEEP_PREFIX, PRACTICE_PREFIX } from '../shared/ai/plan.ts';
import { ownLawEntry, preferOfficial, type OwnNormRow } from '../shared/legal/norms.ts';
import { inRanges, rangesLabel, resolveSessionRefs, type LawRef } from '../shared/legal/refs.ts';
import { lawByKey, type LawEntry } from '../shared/legal/registry.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const env = Object.fromEntries(readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const args = process.argv.slice(2);
const APPLY = args.includes('--aplicar');
const EMAIL = args.includes('--email') ? args[args.indexOf('--email') + 1]?.toLowerCase() : undefined;
const TITLE = 'Seu cronograma recebeu artigos do edital que tinham ficado de fora';

const url = new URL(readFileSync(join(root, 'supabase', '.temp', 'pooler-url'), 'utf8').trim());
url.password = encodeURIComponent(env.SUPABASE_DB_PASSWORD!);
const db = new pg.Client({ connectionString: url.href, ssl: { rejectUnauthorized: false } });
await db.connect();
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows as T[];

const shared = (await q<OwnNormRow & { owner_id: string | null }>(`select owner_id, law_key, short_name, name, urn, match_pattern from legal_norms where match_pattern is not null`));
const lawsFor = (owner: string): LawEntry[] => preferOfficial(shared.filter((r) => !r.owner_id || r.owner_id === owner).map(ownLawEntry).filter((l): l is LawEntry => !!l));

// Artigos de cada norma (só número, sufixo e revogação), uma consulta por norma.
const normArticles = new Map<string, LawArticle[] | null>();
async function articlesOf(law: LawEntry) {
  if (!normArticles.has(law.urn)) {
    const [norm] = await q<{ id: string }>(`select id from legal_norms where urn = $1`, [law.urn]);
    normArticles.set(law.urn, norm ? await q<LawArticle>(`select num, suffix, revoked from legal_articles where norm_id = $1 order by ord`, [norm.id]) : null);
  }
  return normArticles.get(law.urn)!;
}

const plans = await q<{ id: string; owner_id: string; notice_id: string; version: string; email: string }>(`
  select p.id, p.owner_id, p.notice_id, p.active_version_id as version, u.email from study_plans p join auth.users u on u.id = p.owner_id
  where p.status = 'active' and p.active_version_id is not null ${EMAIL ? 'and lower(u.email) = $1' : ''} order by u.email`, EMAIL ? [EMAIL] : []);
let affected = 0, changedSessions = 0;
for (const plan of plans) {
  const extra = lawsFor(plan.owner_id);
  const subjects = await q<{ id: string; name: string }>(`select id, name from notice_subjects where notice_id = $1 order by position`, [plan.notice_id]);
  const items: { subject: string; session: string; date: string | null; added: string }[] = [];
  const updates: { id: string; title: string; refs: LawRef[]; topicIds: string[]; before: string }[] = [];
  for (const subject of subjects) {
    const topics = await q<{ id: string; text: string }>(`select id, text from notice_topics where subject_id = $1 order by position`, [subject.id]);
    const required = requiredLaws(topics.map((t) => t.text), subject.name, extra);
    if (!required.length) continue;
    const withArts = [];
    for (const r of required) {
      const law = lawByKey(r.law, extra), all = law ? await articlesOf(law) : null;
      if (!all) continue;
      const articles = all.filter((a) => inRanges(r.ranges, a.num, a.suffix));
      if (!r.ranges.length && articles.length > 400) continue;
      withArts.push({ ...r, articles });
    }
    const sessions = await q<{ id: string; title: string; topic_ids: string[]; law_refs: unknown }>(
      `select id, title, topic_ids, law_refs from study_sessions where plan_version_id = $1 and subject_id = $2 order by position`, [plan.version, subject.id]);
    const tasks = await q<{ session_id: string; kind: string; date: Date; done_at: Date | null }>(
      `select session_id, kind, date, done_at from tasks where plan_id = $1 and subject_id = $2 and superseded_in_version is null and session_id is not null`, [plan.id, subject.id]);
    const idx = new Map(topics.map((t, i) => [t.id, i]));
    const list = sessions.map((s) => {
      const theory = tasks.filter((t) => t.session_id === s.id && t.kind === 'theory');
      return {
        id: s.id, title: s.title, topics: s.topic_ids.map((id) => idx.get(id)).filter((i): i is number => i !== undefined),
        refs: resolveSessionRefs(s.law_refs, s.title, s.topic_ids.map((id) => topics[idx.get(id) ?? -1]?.text ?? ''), subject.name, extra),
        pending: theory.length > 0 && theory.every((t) => !t.done_at),
        date: theory.map((t) => t.date.toISOString().slice(0, 10)).sort()[0] ?? null,
        deep: s.title.startsWith(DEEP_PREFIX) || s.title.startsWith(PRACTICE_PREFIX),
      };
    });
    const gaps = articleGaps(withArts, list);
    if (!gaps.length) continue;
    // Só sessões ainda não estudadas recebem o que falta (a já estudada não voltaria a ser vista); sem nenhuma, qualquer uma.
    const anyPending = list.some((s) => s.pending && !s.deep);
    const filled = fillArticleGaps(list, gaps, (k) => lawCite(k, extra), { eligible: (s) => !s.deep && (s.pending || !anyPending) });
    for (const i of new Set(filled.fixes.map((f) => f.index))) {
      const s = filled.sessions[i]!;
      updates.push({ id: s.id, title: s.title, refs: s.refs, topicIds: s.topics.map((t) => topics[t]!.id), before: list[i]!.title });
    }
    for (const f of filled.fixes) items.push({ subject: subject.name, session: f.before, date: list[f.index]!.date, added: `${lawCite(f.law, extra)}, ${rangesLabel(f)}` });
  }
  if (!items.length) continue;
  affected++; changedSessions += updates.length;
  console.log(`\n${plan.email} (plano ${plan.id.slice(0, 8)})`);
  for (const it of items) console.log(`  ${it.subject} · ${it.date ?? 'sem data'} · "${it.session}" + ${it.added}`);
  if (!APPLY) continue;
  await db.query('begin');
  try {
    for (const u of updates) {
      await db.query(`update study_sessions set title = $2, law_refs = $3::jsonb, topic_ids = $4::uuid[] where id = $1`, [u.id, u.title, JSON.stringify(u.refs.filter((r) => r.ranges.length)), u.topicIds]);
      await db.query(`update tasks set title = replace(title, $2, $3) where session_id = $1 and superseded_in_version is null and done_at is null`, [u.id, u.before, u.title]);
    }
    await db.query(`insert into plan_notices (owner_id, plan_id, kind, title, items) values ($1, $2, 'coverage', $3, $4::jsonb)`, [plan.owner_id, plan.id, TITLE, JSON.stringify(items)]);
    await db.query('commit');
  } catch (e) { await db.query('rollback'); throw e; }
}
console.log(`\n${plans.length} planos ativos; ${affected} com artigos faltando (${changedSessions} sessões). ${APPLY ? 'Corrigidos e avisados.' : 'Nada gravado (use --aplicar).'}`);
await db.end();
