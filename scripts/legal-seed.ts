// Carrega no banco as leis do registro (texto compilado do normas.leg.br), pela conexão direta ao Postgres.
// Uso: node --experimental-strip-types scripts/legal-seed.ts [CP CPP ...]   (sem argumentos: todas)
// Mesmo separador da Edge Function legal-text; marcações dos usuários são preservadas (upsert por rótulo).
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { parseLawHtml } from '../shared/legal/parse.ts';
import { LAWS } from '../shared/legal/registry.ts';

const root = new URL('..', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('.env', root), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const url = new URL(readFileSync(new URL('supabase/.temp/pooler-url', root), 'utf8').trim());
url.password = encodeURIComponent(env.SUPABASE_DB_PASSWORD!);
const db = new pg.Client({ connectionString: url.href, ssl: { rejectUnauthorized: false } });
await db.connect();

const wanted = process.argv.slice(2);
for (const law of LAWS.filter((l) => !wanted.length || wanted.includes(l.key))) {
  try {
    const meta = await (await fetch(`https://normas.leg.br/api/public/normas?urn=${encodeURIComponent(law.urn)}&tipo_documento=maior-detalhe`)).json() as { encoding?: { version?: string; contentUrl?: string; encodingFormat?: string }[] };
    const html = (meta.encoding ?? []).filter((e) => e.contentUrl && /html/.test(e.encodingFormat ?? 'html'));
    const enc = html.find((e) => e.version === 'Current') ?? html[0];
    if (!enc?.contentUrl) throw Error('sem texto no normas.leg.br');
    const contentUrl = enc.contentUrl.replace('/api/binario/', '/api/public/binario/');
    const articles = parseLawHtml(await (await fetch(contentUrl)).text());
    if (articles.length < 3) throw Error('sem artigos reconhecíveis');
    await db.query('begin');
    const { rows: [norm] } = await db.query(
      `insert into public.legal_norms (urn, law_key, name, short_name, source_url, content_url, version, articles_count, fetched_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,now())
       on conflict (urn) do update set law_key=excluded.law_key, name=excluded.name, short_name=excluded.short_name, content_url=excluded.content_url,
         version=excluded.version, articles_count=excluded.articles_count, fetched_at=now() returning id`,
      [law.urn, law.key, law.name, law.short, `https://normas.leg.br/?urn=${law.urn}`, contentUrl, enc.version === 'Current' ? 'Current' : 'Original', articles.length]);
    // Em lotes de 500 (uma ida ao banco por lote).
    for (let i = 0; i < articles.length; i += 500) {
      await db.query(
        `insert into public.legal_articles (norm_id, ord, label, num, suffix, heading, text, notes, revoked)
         select $1, x.ord, x.label, x.num, x.suffix, x.heading, x.text, array(select jsonb_array_elements_text(x.notes)), x.revoked
         from jsonb_to_recordset($2::jsonb) as x(ord int, label text, num int, suffix text, heading text, text text, notes jsonb, revoked boolean)
         on conflict (norm_id, label) do update set ord=excluded.ord, num=excluded.num, suffix=excluded.suffix, heading=excluded.heading,
           text=excluded.text, notes=excluded.notes, revoked=excluded.revoked`,
        [norm.id, JSON.stringify(articles.slice(i, i + 500))]);
    }
    const { rowCount } = await db.query('delete from public.legal_articles where norm_id = $1 and not (label = any($2))', [norm.id, articles.map((a) => a.label)]);
    await db.query('commit');
    console.log(`${law.short.padEnd(14)} ${String(articles.length).padStart(5)} artigos · ${enc.version}${rowCount ? ` · ${rowCount} removidos` : ''}`);
  } catch (e) {
    await db.query('rollback').catch(() => {});
    console.log(`${law.short.padEnd(14)} ERRO: ${(e as Error).message}`);
  }
}
await db.end();
