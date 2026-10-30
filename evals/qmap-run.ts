// Avaliação dos filtros automáticos de questões (Quest API) sobre as sessões reais do cronograma no banco.
// Uso: node --experimental-strip-types evals/qmap-run.ts [sessões-por-matéria=2]
// Usa as mesmas funções da Edge Function (mapSubject, mapSession, searchFilters). Mede assuntos por sessão,
// disponibilidade e relevância (a IA julga se cada questão treina o conteúdo da sessão). Só lê o banco.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { z } from 'zod';
import { costUsd, generateJson } from '../shared/ai/gemini.ts';
import { normalizeText } from '../shared/ai/notice.ts';
import { QuestClient, type QuestQuestion } from '../shared/qbank/client.ts';
import { mapSession, mapSubject, searchFilters, type MapDeps } from '../shared/qbank/map.ts';

const root = new URL('..', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('.env', root), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const url = new URL(readFileSync(new URL('supabase/.temp/pooler-url', root), 'utf8').trim()); url.password = encodeURIComponent(env.SUPABASE_DB_PASSWORD!);
const db = new pg.Client({ connectionString: url.href, ssl: { rejectUnauthorized: false } }); await db.connect();
const quest = new QuestClient(env.QUEST_API_KEY!);
const model = env.GEMINI_MODEL || 'gemini-3.8-flash', apiKey = env.GEMINI_API_KEY!;
const PRICE = { inputPerMtokUsd: 0.75, outputPerMtokUsd: 3.75 };
let usd = 0;
const plain = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const perSubject = Number(process.argv[2] ?? 2), only = process.argv[3] ?? ''; // [sessões por matéria] [filtro de matéria]
const cache = new Map<string, string[]>();
const deps: MapDeps = {
  materias: (q) => quest.materias(q),
  assuntosOf: async (m) => { if (!cache.has(m)) cache.set(m, await quest.assuntos(m)); return cache.get(m)!; },
  ai: async (schema, jsonSchema, prompt) => { const r = await generateJson({ apiKey, model, schema, jsonSchema, parts: [{ text: prompt }] }); usd += costUsd(r.usage, PRICE); return r.data; },
};

const { rows: [notice] } = await db.query(`select id, board, role_name from public.notices where status = 'reviewed' order by created_at desc limit 1`);
const { rows: subjects } = await db.query(`select s.id, s.name, array(select t.text from public.notice_topics t where t.subject_id = s.id order by t.position) topics from public.notice_subjects s where s.notice_id = $1 order by s.position`, [notice.id]);
const { rows: sessions } = await db.query(
  `select ss.id, ss.subject_id, ss.title, ss.keyword, array(select t.text from public.notice_topics t where t.id = any(ss.topic_ids)) topics
   from public.study_sessions ss join public.study_plans p on p.active_version_id = ss.plan_version_id where p.notice_id = $1 order by ss.subject_id, ss.position`, [notice.id]);
await db.end();
const bancas = await quest.bancas(String(notice.board).split(/[\s/-]/)[0]!);
const banca = bancas.find((b) => normalizeText(b) === normalizeText(notice.board)) ?? bancas[0] ?? '';
console.log(`${notice.role_name} · banca "${notice.board}" → "${banca}" · ${sessions.length} sessões\n`);

const Judge = z.object({ avaliacoes: z.array(z.object({ id: z.string(), veredito: z.enum(['sim', 'parcial', 'nao']), motivo: z.string() })) });
const t = { sessions: 0, mapped: 0, empty: 0, sim: 0, parcial: 0, nao: 0 };
for (const s of subjects.filter((x) => !only || normalizeText(x.name).includes(normalizeText(only)))) {
  const sm = await mapSubject(deps, { name: s.name, topics: s.topics });
  console.log(`■ ${s.name} → ${sm.materia ? `"${sm.materia}"` : 'SEM matéria'} (${sm.how})`);
  for (const ss of sessions.filter((x) => x.subject_id === s.id).slice(0, perSubject)) {
    t.sessions++;
    const f = await mapSession(deps, sm.materia, { subject: s.name, title: ss.title, keyword: ss.keyword, topics: ss.topics });
    let sample: QuestQuestion[] = [], used = '';
    for (const sf of searchFilters(f, banca)) { const r = await quest.questoes(sf.params, 2); if (r.items.length) { sample = r.items; used = sf.key; break; } }
    if (!sample.length) { t.empty++; console.log(`   · ${ss.title.slice(0, 80)}\n     ${f.materia ?? '—'} · ${f.assuntos.join(' | ') || '—'} (${f.how}) → sem questões`); continue; }
    t.mapped++;
    const j = await generateJson({ apiKey, model, schema: Judge, jsonSchema: z.toJSONSchema(Judge, { target: 'draft-7' }), parts: [{ text:
      `Sessão de estudo: "${ss.title}" (${s.name}). Conteúdo: ${ss.topics.join(' | ').slice(0, 600)}\nPara cada questão, diga se ela treina o conteúdo desta sessão: "sim", "parcial" (mesma matéria, assunto vizinho) ou "nao". Motivo em até 12 palavras.\n` +
      sample.map((q) => `id=${q.id} · assunto no banco: ${q.classificacao.assunto}\n${plain(q.enunciado).slice(0, 600)}`).join('\n\n') }] });
    usd += costUsd(j.usage, PRICE);
    for (const a of j.data.avaliacoes) t[a.veredito]++;
    console.log(`   · ${ss.title.slice(0, 80)}\n     ${f.materia} · ${f.assuntos.slice(0, 3).join(' | ')} (${f.how}) via ${used} → ${j.data.avaliacoes.map((a) => a.veredito + (a.veredito !== 'sim' ? ` (${a.motivo})` : '')).join('; ')}`);
  }
}
const n = t.sim + t.parcial + t.nao;
console.log(`\nRESUMO: ${t.mapped}/${t.sessions} sessões com questões · ${t.empty} sem questões (avisadas) · relevância: ${t.sim} sim, ${t.parcial} parcial, ${t.nao} não de ${n} (${n ? Math.round(((t.sim + t.parcial / 2) / n) * 100) : 0}% ponderado) · créditos ≈ ${quest.credits} · Gemini US$ ${usd.toFixed(3)}`);
