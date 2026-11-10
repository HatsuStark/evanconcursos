// Carrega no banco as fontes abertas do catálogo (shared/sources/catalog.ts), em trechos com página e seção, pela
// conexão direta ao Postgres. Mostra o trecho de licença achado no PDF, para conferir a cada carga.
// Uso: node --experimental-strip-types scripts/sources-seed.ts [chave ...] [--arquivo chave=caminho.pdf ...]
//   sem chaves: todas. Fonte sem PDF baixável (site com bloqueio a robôs) entra só com --arquivo (PDF baixado à mão
//   da página oficial da obra). Recarregar substitui os trechos da fonte.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { getDocumentProxy } from 'unpdf';
import { OPEN_SOURCES, type OpenSourceEntry } from '../shared/sources/catalog.ts';
import { chunkPages, fixLatexAccents, markHeadings, pageLines } from '../shared/sources/chunk.ts';

const root = new URL('..', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('.env', root), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const url = new URL(readFileSync(new URL('supabase/.temp/pooler-url', root), 'utf8').trim());
url.password = encodeURIComponent(env.SUPABASE_DB_PASSWORD!);
const db = new pg.Client({ connectionString: url.href, ssl: { rejectUnauthorized: false } });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

const args = process.argv.slice(2);
const files = new Map(args.flatMap((a, i) => (a === '--arquivo' && args[i + 1]?.includes('=') ? [args[i + 1]!.split(/=(.*)/s).slice(0, 2) as [string, string]] : [])));
const wanted = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--arquivo');

async function bytesOf(s: OpenSourceEntry) {
  const file = files.get(s.key);
  if (file) return new Uint8Array(readFileSync(file));
  if (!s.pdf) throw new Error(`sem PDF baixável: baixe em ${s.url} e rode com --arquivo ${s.key}=caminho.pdf`);
  const res = await fetch(s.pdf, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`download ${res.status}`);
  if (!/pdf/.test(res.headers.get('content-type') ?? '')) throw new Error(`não veio PDF (${res.headers.get('content-type')})`);
  return new Uint8Array(await res.arrayBuffer());
}

// Trecho com a licença nas primeiras páginas, para conferência humana a cada carga.
function licenseSnippet(pages: string[], s: OpenSourceEntry) {
  const text = pages.slice(0, 10).join('\n').replace(/\s+/g, ' ');
  const text2 = s.latexAccents ? fixLatexAccents(text) : text;
  const i = text2.search(/Creative Commons|Licen[çc]a|reprodu[çc][ãa]o|GNU General Public/i);
  return i < 0 ? null : text2.slice(Math.max(0, i - 60), i + 220);
}

await db.connect();
try {
  for (const s of OPEN_SOURCES.filter((x) => !wanted.length || wanted.includes(x.key))) {
    try {
      const pdf = await getDocumentProxy(await bytesOf(s));
      const lines = [];
      for (let p = 1; p <= pdf.numPages; p++) lines.push(pageLines((await (await pdf.getPage(p)).getTextContent()).items as { str?: string; hasEOL?: boolean; height?: number }[]));
      const pages = markHeadings(lines);
      const chunks = chunkPages(pages, { latexAccents: s.latexAccents });
      if (chunks.length < 10) throw new Error(`só ${chunks.length} trechos reconhecidos`);
      await db.query('begin');
      await db.query(
        `insert into public.open_sources (key, title, authors, publisher, year, license, license_url, commercial_ok, url, note, chunks_count, fetched_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
         on conflict (key) do update set title=excluded.title, authors=excluded.authors, publisher=excluded.publisher, year=excluded.year, license=excluded.license,
           license_url=excluded.license_url, commercial_ok=excluded.commercial_ok, url=excluded.url, note=excluded.note, chunks_count=excluded.chunks_count, fetched_at=now()`,
        [s.key, s.title, s.authors, s.publisher, s.year, s.license, s.licenseUrl, s.commercialOk, s.url, s.note ?? '', chunks.length]);
      await db.query('delete from public.open_source_chunks where source_key = $1', [s.key]);
      for (let i = 0; i < chunks.length; i += 300) {
        await db.query(
          `insert into public.open_source_chunks (source_key, ord, page_from, page_to, heading, text)
           select $1, x.ord, x."pageFrom", x."pageTo", x.heading, x.text from jsonb_to_recordset($2::jsonb) as x(ord int, "pageFrom" int, "pageTo" int, heading text, text text)`,
          [s.key, JSON.stringify(chunks.slice(i, i + 300))]);
      }
      await db.query('commit');
      const lic = licenseSnippet(pages, s);
      console.log(`${s.key.padEnd(20)} ${String(pdf.numPages).padStart(4)} páginas · ${String(chunks.length).padStart(4)} trechos · ${s.license}`);
      console.log(`  licença no PDF: ${lic ? `"…${lic}…"` : 'NÃO ACHADA — confira antes de manter a fonte'}`);
    } catch (e) {
      await db.query('rollback').catch(() => {});
      console.error(`${s.key.padEnd(20)} ERRO: ${(e as Error).message}`);
      process.exitCode = 1;
    }
  }
} finally {
  await db.end();
}
