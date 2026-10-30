// Avaliação da apostila da IA em sessões reais do cronograma: tamanho, citações verificadas e amostra do texto.
// Uso: node --experimental-strip-types evals/guide-run.ts [completa|revisao] [n-sessões=3]
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { costUsd, generateJson } from '../shared/ai/gemini.ts';
import { Guide, guideJsonSchema, guidePrompt, sourceRef, verifyGuide, type GuideDepth } from '../shared/ai/guide.ts';
import { findLawRefs, inRanges } from '../shared/legal/refs.ts';
import { lawByKey } from '../shared/legal/registry.ts';

const root = new URL('..', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('.env', root), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const url = new URL(readFileSync(new URL('supabase/.temp/pooler-url', root), 'utf8').trim()); url.password = encodeURIComponent(env.SUPABASE_DB_PASSWORD!);
const db = new pg.Client({ connectionString: url.href, ssl: { rejectUnauthorized: false } }); await db.connect();
const depth = (process.argv[2] ?? 'completa') as GuideDepth, n = Number(process.argv[3] ?? 3);
const PRICE = { inputPerMtokUsd: 0.75, outputPerMtokUsd: 3.75 };

const { rows: [notice] } = await db.query(`select id, board, role_name from public.notices where status = 'reviewed' order by created_at desc limit 1`);
// Sessões com lei citada (as mais exigentes para a verificação) + uma sem lei.
const { rows: sessions } = await db.query(
  `select ss.title, s.name subject, array(select t.text from public.notice_topics t where t.id = any(ss.topic_ids)) topics
   from public.study_sessions ss join public.notice_subjects s on s.id = ss.subject_id join public.study_plans p on p.active_version_id = ss.plan_version_id
   where p.notice_id = $1 order by (ss.title ~ 'arts?\\.') desc, random() limit $2`, [notice.id, n]);

for (const s of sessions) {
  const refs = findLawRefs(s.title, s.subject).filter((r) => r.ranges.length);
  const provided: { lawKey: string; label: string; num: number; suffix: string; text: string }[] = [];
  for (const r of refs) {
    const law = lawByKey(r.law)!;
    const { rows } = await db.query(`select a.label, a.num, a.suffix, a.text from public.legal_articles a join public.legal_norms n on n.id = a.norm_id where n.urn = $1 and a.num between $2 and $3 order by a.ord`,
      [law.urn, Math.min(...r.ranges.map((x) => x.from)), Math.max(...r.ranges.map((x) => x.to))]);
    provided.push(...rows.filter((a) => inRanges(r.ranges, a.num, a.suffix)).slice(0, 25).map((a) => ({ lawKey: r.law, ...a })));
  }
  const law = provided.map((p) => ({ ref: sourceRef(p.lawKey, p.label), text: p.text.slice(0, 1500) }));
  const t0 = Date.now();
  const r = await generateJson({ apiKey: env.GEMINI_API_KEY!, model: env.GEMINI_MODEL || 'gemini-3.8-flash', schema: Guide, jsonSchema: guideJsonSchema(), temperature: 0.3,
    parts: [{ text: guidePrompt({ depth, banca: notice.board, cargo: notice.role_name, subject: s.subject, title: s.title, topics: s.topics, law }) }] });
  const v = verifyGuide(r.data, provided, s.subject);
  const words = JSON.stringify(r.data).split(/\s+/).length;
  console.log(`\n■ ${s.subject} · ${s.title}\n  ${law.length} artigos fornecidos · ${Math.round((Date.now() - t0) / 1000)}s · US$ ${costUsd(r.usage, PRICE).toFixed(4)} · ~${words} palavras · ${r.data.secoes.length} seções · ${r.data.perguntas.length} perguntas`);
  console.log(`  legislação comentada: ${v.guide.legislacao.map((l) => l.ref).join('; ') || '—'}${v.droppedRefs ? ` · ${v.droppedRefs} ref(s) removida(s) por não estarem nas fontes` : ''}`);
  console.log(`  citações não verificáveis no texto: ${v.unverified.join('; ') || 'nenhuma'}`);
  console.log(`  introdução: ${r.data.introducao.slice(0, 260)}`);
  console.log(`  1ª seção: ${r.data.secoes[0]?.titulo} — ${r.data.secoes[0]?.texto.slice(0, 260).replace(/\n+/g, ' ')}`);
  console.log(`  pegadinha: ${r.data.pegadinhas[0] ?? '—'}`);
}
await db.end();
