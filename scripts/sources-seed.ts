// Carrega no banco as fontes abertas do catálogo (shared/sources/catalog.ts), em trechos com página (PDF) ou link (site)
// e seção, com o vetor de significado de cada trecho (busca híbrida), pela conexão direta ao Postgres. Mostra o trecho de
// licença achado na obra, para conferir a cada carga.
// Uso: node --experimental-strip-types scripts/sources-seed.ts [chave ...] [--arquivo chave=caminho.pdf ...] [--sem-vetor] [--vetores]
//   sem chaves: todas. Fonte sem PDF baixável (site com bloqueio a robôs) entra só com --arquivo (PDF baixado à mão
//   da página oficial da obra). Recarregar substitui os trechos da fonte.
//   --sem-vetor  carrega os trechos sem calcular os vetores (a busca dessas fontes fica só por palavras)
//   --vetores    não baixa nada: só calcula os vetores que faltam (ou de outro modelo) nos trechos já carregados
//   EMBED_MODEL no .env troca o modelo dos vetores (padrão em shared/sources/embed.ts); a Edge Function usa o mesmo.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { getDocumentProxy } from 'unpdf';
import { OPEN_SOURCES, type OpenSourceEntry } from '../shared/sources/catalog.ts';
import { chunkPages, fixLatexAccents, markHeadings, pageLines, type SourceChunk } from '../shared/sources/chunk.ts';
import { chunkEmbedText, DEFAULT_EMBED_MODEL, embedTexts, toPgVector } from '../shared/sources/embed.ts';
import { crawlSite, htmlToPage, licenseLink } from '../shared/sources/html.ts';

const root = new URL('..', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('.env', root), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const url = new URL(readFileSync(new URL('supabase/.temp/pooler-url', root), 'utf8').trim());
url.password = encodeURIComponent(env.SUPABASE_DB_PASSWORD!);
const db = new pg.Client({ connectionString: url.href, ssl: { rejectUnauthorized: false } });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const MODEL = env.EMBED_MODEL || DEFAULT_EMBED_MODEL;

const args = process.argv.slice(2);
const files = new Map(args.flatMap((a, i) => (a === '--arquivo' && args[i + 1]?.includes('=') ? [args[i + 1]!.split(/=(.*)/s).slice(0, 2) as [string, string]] : [])));
const wanted = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--arquivo');
const NO_VECTORS = args.includes('--sem-vetor'), ONLY_VECTORS = args.includes('--vetores');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Vetores em lotes, com nova tentativa quando a cota por minuto estoura (429).
async function vectors(texts: string[]) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY vazio no .env (ou rode com --sem-vetor)');
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    for (let attempt = 1; ; attempt++) {
      try {
        out.push(...(await embedTexts({ apiKey: env.GEMINI_API_KEY, model: MODEL, texts: texts.slice(i, i + 100), task: 'document', timeoutMs: 60_000 })).vectors);
        break;
      } catch (e) {
        if (attempt >= 5 || !/ 429| 5\d\d/.test((e as Error).message)) throw e;
        await sleep(15_000 * attempt);
      }
    }
  }
  return out;
}

async function pdfBytes(s: OpenSourceEntry) {
  const file = files.get(s.key);
  if (file) return new Uint8Array(readFileSync(file));
  if (!s.pdf) throw new Error(`sem PDF baixável: baixe em ${s.url} e rode com --arquivo ${s.key}=caminho.pdf`);
  const res = await fetch(s.pdf, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`download ${res.status}`);
  if (!/pdf/.test(res.headers.get('content-type') ?? '')) throw new Error(`não veio PDF (${res.headers.get('content-type')})`);
  return new Uint8Array(await res.arrayBuffer());
}

// Trecho com a licença no começo da obra, para conferência humana a cada carga.
function licenseSnippet(pages: string[], s: OpenSourceEntry) {
  const text = pages.slice(0, 10).join('\n').replace(/\s+/g, ' ');
  const text2 = s.latexAccents ? fixLatexAccents(text) : text;
  const i = text2.search(/Creative Commons|Licen[çc]a|reprodu[çc][ãa]o|GNU (General Public|Free Documentation)/i);
  return i < 0 ? null : text2.slice(Math.max(0, i - 60), i + 220);
}

// Obra lida em páginas: do PDF (com títulos pela fonte maior) ou do site (títulos h1-h6, uma página por link).
async function readSource(s: OpenSourceEntry): Promise<{ pages: string[]; hrefs: string[]; license: string | null }> {
  if (s.html && !files.has(s.key)) {
    const site = await crawlSite(s.html.start, s.html.include, s.html.max ?? 400, async (u) => {
      await sleep(250); // sem pressa: não sobrecarregar o site da obra
      const res = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60_000) }).catch(() => null);
      if (!res?.ok || !/html/.test(res.headers.get('content-type') ?? '')) { console.error(`  pulou ${u} (${res?.status ?? 'erro de rede'})`); return null; }
      return res.text();
    });
    const pages = site.map((p) => htmlToPage(p.html).text);
    const cc = site.map((p) => licenseLink(p.html)).find(Boolean);
    const lic = licenseSnippet(pages, s);
    return { pages, hrefs: site.map((p) => p.url), license: [cc && `link CC: ${cc}`, lic && `"…${lic}…"`].filter(Boolean).join(' · ') || null };
  }
  const pdf = await getDocumentProxy(await pdfBytes(s));
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) lines.push(pageLines((await (await pdf.getPage(p)).getTextContent()).items as { str?: string; hasEOL?: boolean; height?: number }[]));
  const pages = markHeadings(lines), lic = licenseSnippet(pages, s);
  return { pages, hrefs: [], license: lic && `"…${lic}…"` };
}

async function load(s: OpenSourceEntry) {
  const { pages, hrefs, license } = await readSource(s);
  const chunks: (SourceChunk & { href: string; embedding: string | null })[] = chunkPages(pages, { latexAccents: s.latexAccents })
    .map((c) => ({ ...c, href: hrefs[c.pageFrom - 1] ?? '', embedding: null }));
  if (chunks.length < 10) throw new Error(`só ${chunks.length} trechos reconhecidos`);
  if (!NO_VECTORS) (await vectors(chunks.map(chunkEmbedText))).forEach((v, i) => { chunks[i]!.embedding = toPgVector(v); });
  await db.query('begin');
  await db.query(
    `insert into public.open_sources (key, title, authors, publisher, year, license, license_url, commercial_ok, url, note, chunks_count, format, embed_model, fetched_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
     on conflict (key) do update set title=excluded.title, authors=excluded.authors, publisher=excluded.publisher, year=excluded.year, license=excluded.license,
       license_url=excluded.license_url, commercial_ok=excluded.commercial_ok, url=excluded.url, note=excluded.note, chunks_count=excluded.chunks_count,
       format=excluded.format, embed_model=excluded.embed_model, fetched_at=now()`,
    [s.key, s.title, s.authors, s.publisher, s.year, s.license, s.licenseUrl, s.commercialOk, s.url, s.note ?? '', chunks.length, hrefs.length ? 'html' : 'pdf', NO_VECTORS ? '' : MODEL]);
  await db.query('delete from public.open_source_chunks where source_key = $1', [s.key]);
  for (let i = 0; i < chunks.length; i += 100) {
    await db.query(
      `insert into public.open_source_chunks (source_key, ord, page_from, page_to, heading, text, href, embedding)
       select $1, x.ord, x."pageFrom", x."pageTo", x.heading, x.text, x.href, x.embedding::extensions.vector
       from jsonb_to_recordset($2::jsonb) as x(ord int, "pageFrom" int, "pageTo" int, heading text, text text, href text, embedding text)`,
      [s.key, JSON.stringify(chunks.slice(i, i + 100))]);
  }
  await db.query('commit');
  console.log(`${s.key.padEnd(20)} ${String(pages.length).padStart(4)} ${hrefs.length ? 'páginas do site' : 'páginas'} · ${String(chunks.length).padStart(4)} trechos · ${NO_VECTORS ? 'sem vetores' : 'com vetores'} · ${s.license}`);
  console.log(`  licença na obra: ${license ?? 'NÃO ACHADA — confira antes de manter a fonte'}`);
}

// Só os vetores: trechos já carregados sem vetor ou com vetor de outro modelo.
async function backfill(s: OpenSourceEntry) {
  const { rows: [src] } = await db.query('select embed_model from public.open_sources where key = $1', [s.key]);
  if (!src) { console.log(`${s.key.padEnd(20)} não carregada (rode sem --vetores)`); return; }
  const { rows } = await db.query(
    `select id, heading, text from public.open_source_chunks where source_key = $1 and (embedding is null or $2::text <> $3::text) order by ord`,
    [s.key, src.embed_model, MODEL]);
  if (rows.length) {
    const vs = await vectors(rows.map(chunkEmbedText));
    await db.query('begin');
    for (let i = 0; i < rows.length; i += 200) {
      await db.query(
        `update public.open_source_chunks c set embedding = x.embedding::extensions.vector from jsonb_to_recordset($1::jsonb) as x(id uuid, embedding text) where c.id = x.id`,
        [JSON.stringify(rows.slice(i, i + 200).map((r, j) => ({ id: r.id, embedding: toPgVector(vs[i + j]!) })))]);
    }
    await db.query('update public.open_sources set embed_model = $2 where key = $1', [s.key, MODEL]);
    await db.query('commit');
  }
  console.log(`${s.key.padEnd(20)} ${String(rows.length).padStart(4)} vetores calculados (${MODEL})`);
}

await db.connect();
try {
  for (const s of OPEN_SOURCES.filter((x) => !wanted.length || wanted.includes(x.key))) {
    try {
      await (ONLY_VECTORS ? backfill(s) : load(s));
    } catch (e) {
      await db.query('rollback').catch(() => {});
      console.error(`${s.key.padEnd(20)} ERRO: ${(e as Error).message}`);
      process.exitCode = 1;
    }
  }
} finally {
  await db.end();
}
