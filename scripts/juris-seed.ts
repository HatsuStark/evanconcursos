// Carrega no banco a jurisprudência oficial (súmulas e teses do STF e do STJ) e liga cada item aos artigos de lei,
// pela conexão direta ao Postgres. Leitura das fontes em shared/legal/juris.ts.
// Uso: node --experimental-strip-types scripts/juris-seed.ts [stj-sumulas stj-temas stf-sumulas stf-rg] [--tudo]
//        sem fontes: todas. Súmulas do STF já gravadas não são baixadas de novo (uma página por súmula), salvo com --tudo.
//      node --experimental-strip-types scripts/juris-seed.ts classificar [--limite N]
//        itens vigentes sem artigo citado: a IA propõe os artigos e uma segunda chamada confere cada um com o texto do
//        artigo. Só o que passa nas duas vira ligação (origin 'ia'). Reimportar um item com texto mudado refaz a classificação.
// Reimportar é seguro: atualiza texto e situação, e as ligações de referência/citação são refeitas.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { getDocumentProxy } from 'unpdf';
import { z } from 'zod';
import { costUsd, generateJson, type GeminiUsage } from '../shared/ai/gemini.ts';
import {
  parseCsv, parseStfSumulaList, parseStfSumulaPage, parseStjSumulas, type Precedent, precedentLabel, stfSumula, stfTheses, type StfThesis, stjTemas,
} from '../shared/legal/juris.ts';
import { lawByUrn } from '../shared/legal/registry.ts';

const root = new URL('..', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('.env', root), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const url = new URL(readFileSync(new URL('supabase/.temp/pooler-url', root), 'utf8').trim());
url.password = encodeURIComponent(env.SUPABASE_DB_PASSWORD!);
const db = new pg.Client({ connectionString: url.href, ssl: { rejectUnauthorized: false } });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(u: string, init: RequestInit = {}): Promise<Response> {
  for (let i = 0; ; i++) {
    const res = await fetch(u, { ...init, headers: { 'User-Agent': UA, ...init.headers }, signal: AbortSignal.timeout(120_000) }).catch((e: Error) => e);
    if (res instanceof Response && res.ok) return res;
    if (i >= 2) throw new Error(`${new URL(u).host}: ${res instanceof Response ? res.status : res.message}`);
    await sleep(2000 * (i + 1));
  }
}

// ---------- gravação ----------

async function save(list: Precedent[]) {
  for (let i = 0; i < list.length; i += 300) {
    const chunk = list.slice(i, i + 300);
    await db.query('begin');
    const { rows } = await db.query<{ id: string; court: string; kind: string; number: number }>(
      `insert into public.legal_precedents as p (court, kind, number, text, subject, decided_on, active, source_url, fetched_at)
       select x.court, x.kind, x.number, x.text, x.subject, x.decided_on, x.active, x.source_url, now()
       from jsonb_to_recordset($1::jsonb) as x(court text, kind text, number int, text text, subject text, decided_on date, active boolean, source_url text)
       on conflict (court, kind, number) do update set text = excluded.text, subject = excluded.subject, decided_on = excluded.decided_on,
         active = excluded.active, source_url = excluded.source_url, fetched_at = now(),
         classified_at = case when p.text = excluded.text then p.classified_at end
       returning id, court, kind, number`,
      [JSON.stringify(chunk.map((p) => ({ court: p.court, kind: p.kind, number: p.number, text: p.text, subject: p.subject, decided_on: p.decidedOn, active: p.active, source_url: p.sourceUrl })))]);
    const ids = new Map(rows.map((r) => [`${r.court}:${r.kind}:${r.number}`, r.id]));
    const links = chunk.flatMap((p) => p.links.map((l) => ({ id: ids.get(`${p.court}:${p.kind}:${p.number}`), law: l.law, art: l.art, origin: l.origin })));
    const withLinks = [...new Set(links.map((l) => l.id))];
    // Ligações oficiais refeitas; as da IA saem quando o item passou a ter ligação oficial ou mudou de texto.
    await db.query(`delete from public.legal_precedent_links where precedent_id = any($1::uuid[]) and (origin <> 'ia' or precedent_id = any($2::uuid[]))`, [[...ids.values()], withLinks]);
    await db.query(`delete from public.legal_precedent_links l using public.legal_precedents p
      where l.precedent_id = p.id and l.origin = 'ia' and p.classified_at is null and p.id = any($1::uuid[])`, [[...ids.values()]]);
    if (links.length) {
      await db.query(`insert into public.legal_precedent_links (precedent_id, law_key, art_num, origin)
        select x.id, x.law, x.art, x.origin from jsonb_to_recordset($1::jsonb) as x(id uuid, law text, art int, origin text) on conflict do nothing`, [JSON.stringify(links)]);
    }
    await db.query('commit');
  }
  const active = list.filter((p) => p.active);
  return `${list.length} itens (${active.length} vigentes, ${active.filter((p) => p.links.length).length} com artigo ligado)`;
}

// ---------- fontes ----------

const STJ_SUMULAS_PDF = 'https://processo.stj.jus.br/SCON/getFile?url=/docs_internet/jurisprudencia/tematica/download/SU/Sumulas/SumulasSTJ.pdf';
const STJ_TEMAS_CSV = 'https://dadosabertos.web.stj.jus.br/dataset/4238da2f-c07b-4c1a-b345-4402accacdcf/resource/df29da13-7d6b-41ba-ad96-cd1a5bbd191c/download/temas.csv';
const STF_LIST = (base: number) => `https://portal.stf.jus.br/jurisprudencia/sumariosumulas.asp?base=${base}`;
const STF_RG = 'https://portal.stf.jus.br/repercussaogeral/retornartesesrepercussaogeral.asp';

async function stjSumulas() {
  const pdf = await getDocumentProxy(new Uint8Array(await (await get(STJ_SUMULAS_PDF)).arrayBuffer()));
  const pages: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const c = await (await pdf.getPage(p)).getTextContent();
    pages.push(c.items.map((i) => ('str' in i ? i.str + (i.hasEOL ? '\n' : '') : '')).join(''));
  }
  return parseStjSumulas(pages.join('\n'));
}

async function stjTemasCsv() {
  return stjTemas(parseCsv(await (await get(STJ_TEMAS_CSV)).text()));
}

async function stfRg() {
  const res = await get(STF_RG, { method: 'POST', body: new URLSearchParams({ tipo: 'com' }), headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://portal.stf.jus.br/repercussaogeral/teses.asp' } });
  return stfTheses(await res.json() as StfThesis[]);
}

// Uma página por súmula: só as que faltam no banco (ou todas, com --tudo). Situação vem da lista e é sempre atualizada.
async function stfSumulas(all: boolean) {
  const out: Precedent[] = [];
  for (const [kind, base] of [['sumula_vinculante', 26], ['sumula', 30]] as const) {
    const list = parseStfSumulaList(await (await get(STF_LIST(base))).text());
    if (list.length < 50) throw new Error(`lista de súmulas do STF (base ${base}) veio com ${list.length} itens`);
    const { rows } = await db.query<{ number: number; text: string }>(`select number, text from public.legal_precedents where court = 'STF' and kind = $1`, [kind]);
    const known = new Map(rows.map((r) => [r.number, r.text]));
    const todo = list.filter((s) => all || !known.get(s.number));
    let done = 0;
    for (let i = 0; i < todo.length; i += 4) {
      await Promise.all(todo.slice(i, i + 4).map(async (s) => {
        const text = parseStfSumulaPage(await (await get(`${STF_LIST(base)}&sumula=${s.id}`)).text());
        if (text) known.set(s.number, text); else console.warn(`  sem enunciado: ${kind} ${s.number}`);
      }));
      done += Math.min(4, todo.length - i);
      if (done % 100 < 4) process.stdout.write(`  ${kind}: ${done}/${todo.length}\r`);
      await sleep(300);
    }
    out.push(...list.flatMap((s) => (known.get(s.number) ? [stfSumula(kind, s, known.get(s.number)!)] : [])));
  }
  return out;
}

// ---------- classificação pela IA ----------

const Proposal = z.object({ itens: z.array(z.object({ id: z.number().int(), lei: z.string(), artigos: z.array(z.number().int()) })) });
const Verdict = z.object({ respostas: z.array(z.object({ n: z.number().int(), ok: z.boolean() })) });
const usage: GeminiUsage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };

async function ask<S extends z.ZodType>(prompt: string, schema: S): Promise<z.infer<S>> {
  const model = env.GEMINI_MODEL!, apiKey = model.startsWith('claude-') ? env.ANTHROPIC_API_KEY! : env.GEMINI_API_KEY!;
  const r = await generateJson({ apiKey, model, parts: [{ text: prompt }], schema, jsonSchema: z.toJSONSchema(schema, { target: 'draft-7' }), temperature: 0, thinkingLevel: 'low', timeoutMs: 120_000 });
  usage.inputTokens += r.usage.inputTokens; usage.outputTokens += r.usage.outputTokens; usage.thinkingTokens += r.usage.thinkingTokens;
  return r.data;
}

async function classify(limit: number) {
  const { rows: items } = await db.query<{ id: string; court: 'STF' | 'STJ'; kind: Precedent['kind']; number: number; text: string; subject: string }>(
    `select p.id, p.court, p.kind, p.number, p.text, p.subject from public.legal_precedents p
     where p.active and p.classified_at is null and not exists (select 1 from public.legal_precedent_links l where l.precedent_id = p.id)
     order by p.court, p.kind, p.number limit $1`, [limit]);
  // Normas com texto no app (registro e normas achadas para todos): a IA só pode escolher entre elas. Norma do registro
  // vale pela chave do registro (a mesma de law_refs), achada pela URN: o law_key gravado pode ter vindo do resolvedor.
  const { rows: found } = await db.query<{ id: string; urn: string; law_key: string; name: string; short_name: string; nums: number[] }>(
    `select n.id, n.urn, n.law_key, n.name, n.short_name, array_agg(a.num) as nums from public.legal_norms n join public.legal_articles a on a.norm_id = n.id and not a.revoked
     where n.owner_id is null and n.law_key <> '' group by n.id`);
  const norms = found.map((n) => ({ ...n, key: lawByUrn(n.urn)?.key ?? n.law_key, nums: new Set(n.nums) }));
  const byKey = new Map(norms.map((n) => [n.key, n]));
  const lawList = norms.map((n) => `${n.key}: ${n.short_name || n.name} — ${n.name}`).join('\n');
  console.log(`Classificando ${items.length} itens com ${env.GEMINI_MODEL} (${norms.length} normas disponíveis)…`);

  type Item = (typeof items)[number];
  type Pair = { item: Item; law: string; art: number };
  const BATCH = 25, PARALLEL = 3;
  const totals = { done: 0, proposed: 0, accepted: 0, linked: 0, failed: 0 };

  // 1) A IA propõe norma e artigos para cada item do lote.
  const propose = async (batch: Item[]): Promise<Pair[]> => {
    const prompt = `Você é especialista em direito brasileiro. Para cada súmula ou tese abaixo, indique a norma da lista e os artigos que ela interpreta ou aplica DIRETAMENTE (o dispositivo que um professor citaria ao lado dela no estudo da lei seca).
Regras:
- Use só normas da lista, pela chave exata (antes dos dois-pontos).
- No máximo 4 artigos, só os principais. Só números de artigo (sem parágrafo ou inciso).
- Se a norma não está na lista, ou se você não tem certeza do artigo, devolva "lei" vazio e "artigos" vazio. Errar é pior que deixar vazio.
Normas disponíveis:
${lawList}

Itens:
${batch.map((p, j) => `${j}. ${precedentLabel(p)}${p.subject ? ` (${p.subject})` : ''}: ${p.text}`).join('\n')}`;
    const out = await ask(prompt, Proposal), pairs: Pair[] = [];
    for (const r of out.itens) {
      const item = batch[r.id], norm = byKey.get(r.lei);
      if (!item || !norm) continue;
      for (const art of [...new Set(r.artigos)].slice(0, 4)) if (norm.nums.has(art)) pairs.push({ item, law: r.lei, art });
    }
    return pairs;
  };

  // 2) Conferência: cada par (item, artigo) com o texto do artigo; só fica o que a IA confirma lendo o artigo.
  const confirm = async (pairs: Pair[]): Promise<Pair[]> => {
    const ok: Pair[] = [];
    for (let i = 0; i < pairs.length; i += 20) {
      const batch = pairs.slice(i, i + 20);
      const { rows: arts } = await db.query<{ law: string; num: number; text: string }>(
        `select distinct on (x.law, a.num) x.law, a.num, a.text from jsonb_to_recordset($1::jsonb) as x(law text, norm uuid, art int)
         join public.legal_articles a on a.norm_id = x.norm and a.num = x.art order by x.law, a.num, a.suffix`,
        [JSON.stringify(batch.map((p) => ({ law: p.law, norm: byKey.get(p.law)!.id, art: p.art })))]);
      const text = new Map(arts.map((a) => [`${a.law}:${a.num}`, a.text.slice(0, 900)]));
      const prompt = `Para cada par abaixo, responda ok=true só se o artigo transcrito é um dispositivo que a súmula/tese interpreta ou aplica diretamente (mesmo instituto, mesma regra). Tema apenas parecido ou artigo genérico = false.
${batch.map((p, j) => `${j}. ${precedentLabel(p.item)}: ${p.item.text}\nArtigo (${byKey.get(p.law)!.short_name || p.law}, art. ${p.art}): ${text.get(`${p.law}:${p.art}`) ?? '(sem texto)'}`).join('\n\n')}`;
      const out = await ask(prompt, Verdict);
      for (const r of out.respostas) if (r.ok && batch[r.n] && text.has(`${batch[r.n]!.law}:${batch[r.n]!.art}`)) ok.push(batch[r.n]!);
    }
    return ok;
  };

  // 3) Grava o lote: ligações confirmadas e classified_at. Lote com falha na IA fica sem classified_at (refeito na próxima).
  const run = async (batch: Item[]) => {
    try {
      const pairs = await propose(batch), ok = await confirm(pairs);
      if (ok.length) {
        await db.query(`insert into public.legal_precedent_links (precedent_id, law_key, art_num, origin)
          select x.id, x.law, x.art, 'ia' from jsonb_to_recordset($1::jsonb) as x(id uuid, law text, art int) on conflict do nothing`,
        [JSON.stringify(ok.map((p) => ({ id: p.item.id, law: p.law, art: p.art })))]);
      }
      await db.query(`update public.legal_precedents set classified_at = now() where id = any($1::uuid[])`, [batch.map((p) => p.id)]);
      totals.proposed += pairs.length; totals.accepted += ok.length; totals.linked += new Set(ok.map((p) => p.item.id)).size;
    } catch (e) {
      totals.failed += batch.length;
      console.error(`
  lote com erro (${batch.length} itens, refeitos na próxima rodada): ${(e as Error).message.slice(0, 200)}`);
    }
    totals.done += batch.length;
    process.stdout.write(`  ${totals.done}/${items.length} itens · ${totals.linked} ligados`);
  };

  const batches = Array.from({ length: Math.ceil(items.length / BATCH) }, (_, i) => items.slice(i * BATCH, (i + 1) * BATCH));
  for (let i = 0; i < batches.length; i += PARALLEL) await Promise.all(batches.slice(i, i + PARALLEL).map(run));

  const { rows: [price] } = await db.query(`select input_per_mtok_usd, output_per_mtok_usd from public.ai_model_prices where model = $1 and effective_from <= current_date order by effective_from desc limit 1`, [env.GEMINI_MODEL]);
  const cost = price ? costUsd(usage, { inputPerMtokUsd: Number(price.input_per_mtok_usd), outputPerMtokUsd: Number(price.output_per_mtok_usd) }) : null;
  console.log(`\n${items.length} itens · ${totals.proposed} artigos propostos · ${totals.accepted} confirmados · ${totals.linked} itens ligados${totals.failed ? ` · ${totals.failed} com erro (rode de novo)` : ''}`);
  console.log(`Tokens: ${usage.inputTokens} entrada, ${usage.outputTokens + usage.thinkingTokens} saída${cost != null ? ` · US$ ${cost.toFixed(4)}` : ''}`);
}

// ---------- execução ----------

const args = process.argv.slice(2);
await db.connect();
try {
  if (args[0] === 'classificar') {
    const i = args.indexOf('--limite');
    await classify(i >= 0 ? Number(args[i + 1]) : 100_000);
  } else {
    const all = args.includes('--tudo'), wanted = args.filter((a) => !a.startsWith('--'));
    const sources: [string, () => Promise<Precedent[]>][] = [
      ['stj-sumulas', stjSumulas], ['stj-temas', stjTemasCsv], ['stf-rg', stfRg], ['stf-sumulas', () => stfSumulas(all)],
    ];
    for (const [name, load] of sources.filter(([n]) => !wanted.length || wanted.includes(n))) {
      try {
        console.log(`${name.padEnd(12)} ${await save(await load())}`);
      } catch (e) {
        await db.query('rollback').catch(() => {});
        console.error(`${name.padEnd(12)} ERRO: ${(e as Error).message}`);
        process.exitCode = 1;
      }
    }
  }
} finally {
  await db.end();
}
