// Relatório de cobertura das fontes abertas: para cada tema (sessão) das matérias sem lei nos editais do banco, roda a
// mesma busca da aba Fontes (palavras + significado) e mostra quais temas ficam sem trecho, por matéria. Aponta também
// matérias cujo grupo ainda não tem fonte e matérias fora de todos os grupos do catálogo. Só lê o banco.
// Uso: node --experimental-strip-types scripts/sources-coverage.ts [--detalhe] [--min-sim 0.6] [--sem-vetor]
//   --detalhe   mostra, para cada tema, a semelhança e a seção do melhor trecho (para calibrar MIN_SIMILARITY)
//   --min-sim   semelhança mínima para trecho achado só pelo significado (padrão: MIN_SIMILARITY de embed.ts)
//   --sem-vetor só a busca por palavras (para comparar com a híbrida)
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { sourcesQuery } from '../shared/ai/sources.ts';
import { sessionLawRefs } from '../shared/legal/refs.ts';
import { groupsForSubject, sourcesForSubject } from '../shared/sources/catalog.ts';
import { DEFAULT_EMBED_MODEL, embedTexts, MIN_SIMILARITY, queryEmbedText, toPgVector } from '../shared/sources/embed.ts';

const root = new URL('..', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('.env', root), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const url = new URL(readFileSync(new URL('supabase/.temp/pooler-url', root), 'utf8').trim());
url.password = encodeURIComponent(env.SUPABASE_DB_PASSWORD!);
const db = new pg.Client({ connectionString: url.href, ssl: { rejectUnauthorized: false } });
const MODEL = env.EMBED_MODEL || DEFAULT_EMBED_MODEL;

const args = process.argv.slice(2);
const DETAIL = args.includes('--detalhe'), NO_VECTORS = args.includes('--sem-vetor');
const minSim = Number(args[args.indexOf('--min-sim') + 1]) || MIN_SIMILARITY;

interface Topic { subject: string; title: string; keyword: string; topics: string[] }
type Verdict = 'ok' | 'fraco' | 'nada';

await db.connect();
try {
  // Temas distintos (matéria + título) de todos os cronogramas; sessões de lei ficam de fora (têm a aba Lei).
  const { rows } = await db.query(`
    select distinct on (sub.name, s.title) sub.name as subject, s.title, s.keyword, s.law_refs,
      coalesce((select array_agg(t.text) from public.notice_topics t where t.id = any(s.topic_ids)), '{}') as topics
    from public.study_sessions s join public.notice_subjects sub on sub.id = s.subject_id
    order by sub.name, s.title`);
  const all = (rows as (Topic & { law_refs: unknown })[])
    .filter((r) => !(Array.isArray(r.law_refs) && r.law_refs.length) && !sessionLawRefs(r.title, r.topics, r.subject).length);

  const noGroup = new Map<string, number>(), noSource = new Map<string, number>(), covered: Topic[] = [];
  for (const t of all) {
    if (!groupsForSubject(t.subject).length) noGroup.set(t.subject, (noGroup.get(t.subject) ?? 0) + 1);
    else if (!sourcesForSubject(t.subject).length) {
      const label = `${t.subject} [${groupsForSubject(t.subject).join(', ')}]`;
      noSource.set(label, (noSource.get(label) ?? 0) + 1);
    } else covered.push(t);
  }

  const { rows: embedded } = await db.query('select key from public.open_sources where embed_model = $1', [MODEL]);
  const useVectors = !NO_VECTORS && embedded.length > 0 && !!env.GEMINI_API_KEY;
  const vecs = useVectors ? (await embedTexts({ apiKey: env.GEMINI_API_KEY, model: MODEL, texts: covered.map(queryEmbedText), task: 'query', timeoutMs: 60_000 })).vectors : [];

  const bySubject = new Map<string, { n: number; ok: number; fraco: number; nada: string[] }>();
  for (const [i, t] of covered.entries()) {
    const keys = sourcesForSubject(t.subject), query = sourcesQuery(t.title, t.keyword);
    const vector = useVectors ? toPgVector(vecs[i]!) : null;
    const { rows: hits } = await db.query('select heading, source_key, sim from public.search_open_chunks_hybrid($1, $2::extensions.vector, $3::text[], 20, $4)', [query, vector, keys, minSim]);
    const { rows: words } = await db.query('select count(*)::int as n from public.search_open_chunks_hybrid($1, null, $2::text[], 50, 1)', [query, keys]);
    const best = hits.reduce((m: number, h: { sim: number | null }) => Math.max(m, h.sim ?? -1), -1);
    // ok: algum trecho parecido no significado (ou, sem vetor, achado por palavras); fraco: só por palavras soltas.
    const verdict: Verdict = !hits.length ? 'nada' : useVectors ? (best >= minSim ? 'ok' : 'fraco') : 'ok';
    const s = bySubject.get(t.subject) ?? { n: 0, ok: 0, fraco: 0, nada: [] };
    s.n++;
    if (verdict === 'nada') s.nada.push(t.title); else s[verdict]++;
    bySubject.set(t.subject, s);
    if (DETAIL) console.log(`${verdict.padEnd(5)} ${best >= 0 ? best.toFixed(3) : '  —  '} ${String(words[0].n).padStart(3)} palavras · ${t.subject} › ${t.title}${hits[0] ? `\n        → [${hits[0].source_key}] ${hits[0].heading}` : ''}`);
  }

  console.log(`\nBusca: ${useVectors ? `palavras + significado (${MODEL}, semelhança mínima ${minSim})` : 'só palavras'} · ${all.length} temas sem lei`);
  console.log('\nMatérias com fonte — temas: ok / fraco (só palavras soltas) / sem trecho');
  for (const [subject, s] of [...bySubject].sort((a, b) => b[1].nada.length - a[1].nada.length)) {
    console.log(`  ${subject}: ${s.n} temas — ${s.ok} ok / ${s.fraco} fraco / ${s.nada.length} sem trecho`);
    for (const title of s.nada) console.log(`      sem trecho: ${title}`);
  }
  const list = (title: string, m: Map<string, number>) => {
    if (!m.size) return;
    console.log(`\n${title}`);
    for (const [k, n] of [...m].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n} temas`);
  };
  list('Grupo do catálogo ainda sem fonte (lacuna para preencher):', noSource);
  list('Matérias fora de todos os grupos (sem lei e sem fonte prevista):', noGroup);
} finally {
  await db.end();
}
