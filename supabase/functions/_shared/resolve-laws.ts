// Acha e grava o texto das normas citadas no edital que não estão no registro (ver shared/legal/resolve.ts).
// Chamado na montagem do cronograma: a norma achada vira entrada de registro para todos (owner_id nulo + match_pattern),
// e as sessões dela passam a ser medidas e a ter lei seca, apostila e questões com o texto. Busca que falhou fica em
// legal_lookups e só é refeita depois de 30 dias.
import type { SupabaseClient } from '@supabase/supabase-js';
import { type UnlistedNorm, unlistedNorms } from '../../../shared/legal/norms.ts';
import type { LegalArticle } from '../../../shared/legal/parse.ts';
import type { LawEntry } from '../../../shared/legal/registry.ts';
import {
  CTRESB_RAW, ctresbDir, federalUrn, infraFolder, type LocalNorm, localEntry, localNormsCited, orgOf, parseLawMarkdown, pickCtresbFile,
  pickInfraFiles, pickSenado, resolvable, resolvedNorm, SENADO_TYPE, type SenadoHit, slugOf, stateUrn, textVersion,
} from '../../../shared/legal/resolve.ts';
import { ingestLaw, MAX_AGE_MS, saveNorm } from './legal.ts';

const SENADO = 'https://legis.senado.leg.br/dadosabertos/legislacao/lista';
const GITHUB_TREES = 'https://api.github.com/repos/ctresb/leis/git/trees/main:';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw Object.assign(new Error(`${new URL(url).host} respondeu ${res.status}`), { status: res.status });
  return res.json();
}

// Itens da pasta no acervo (nomes). Sem GITHUB_TOKEN, a API do GitHub aceita 60 consultas por hora por IP.
async function ctresbList(dir: string): Promise<string[]> {
  const token = Deno.env.get('GITHUB_TOKEN');
  const tree = await getJson(GITHUB_TREES + dir, token ? { Authorization: `Bearer ${token}` } : {}) as { tree?: { path: string }[] } | null;
  return (tree?.tree ?? []).map((t) => t.path);
}

async function ctresbText(path: string) {
  const res = await fetch(`${CTRESB_RAW}/${path}`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`acervo ctresb respondeu ${res.status}`);
  return { ...parseLawMarkdown(await res.text()), rawUrl: `${CTRESB_RAW}/${path}`, pageUrl: `https://github.com/ctresb/leis/blob/main/${path}` };
}

// Texto do acervo: Markdown da pasta do ano. Null se a norma não está lá.
async function fromCtresb(where: 'federal' | string, n: UnlistedNorm, year: string) {
  const dir = ctresbDir(where, n.kind, year);
  const file = pickCtresbFile(await ctresbList(dir), n.num, year);
  if (!file) return null;
  const c = await ctresbText(`${dir}/${file}`);
  return c.articles.length >= 2 ? { ...c, file } : null;
}

const ctresbRow = (c: { meta: { fonte?: string; versao_texto?: string }; rawUrl: string; pageUrl: string }, license: string) => ({
  source_url: c.meta.fonte && /^https?:\/\//.test(c.meta.fonte) ? c.meta.fonte : c.pageUrl, content_url: c.rawUrl,
  version: textVersion(c.meta.versao_texto), license,
});

type Outcome = { normId: string; short: string } | { normId: null; detail: string };

// Índice do Senado. Ele recusa rajadas (503): mais duas tentativas, com espera.
async function senado(n: UnlistedNorm): Promise<SenadoHit | null> {
  const q = new URLSearchParams({ tipo: SENADO_TYPE[n.kind]!, numero: n.num, ...(n.year ? { ano: n.year } : {}) });
  for (let i = 0; ; i++) {
    try { return pickSenado(await getJson(`${SENADO}?${q}`), n.num, n.year); } catch (e) {
      if (i >= 2 || ![429, 503].includes((e as { status?: number }).status ?? 0)) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}

async function resolveFederal(admin: SupabaseClient, n: UnlistedNorm): Promise<Outcome> {
  let hit: SenadoHit | null, copy: Awaited<ReturnType<typeof fromCtresb>> = null;
  try {
    hit = await senado(n);
  } catch (e) {
    // Senado fora do ar: a data vem do nome do arquivo no acervo ("lei-9613-1998-03-03.md").
    if (!n.year) throw e;
    copy = await fromCtresb('federal', n, n.year);
    const d = copy && /-(\d{4})-(\d{2})-(\d{2})(?:-id\d+)?\.md$/.exec(copy.file);
    if (!d) throw e;
    hit = { date: `${d[1]}-${d[2]}-${d[3]}`, year: d[1]!, name: copy!.meta.titulo ?? '', ementa: copy!.meta.ementa ?? '', nickname: '' };
  }
  if (!hit) return { normId: null, detail: 'não está no índice do Senado' };
  const r = resolvedNorm(n, hit.year, null, federalUrn(n.kind, hit.date, n.num), hit.nickname || hit.ementa);
  const extra = { match_pattern: r.pattern, citation: r.citation };
  try {
    return { normId: await ingestLaw(admin, r, extra), short: r.short };
  } catch (e) {
    // Sem texto no normas.leg.br: a cópia do acervo (mesma fonte oficial, convertida).
    const c = copy ?? await fromCtresb('federal', n, hit.year).catch(() => null);
    if (!c) return { normId: null, detail: `normas.leg.br: ${(e as Error).message}`.slice(0, 300) };
    const normId = await saveNorm(admin, { urn: r.urn, law_key: r.key, name: r.name, short_name: r.short, ...extra, ...ctresbRow(c, 'acervo ctresb/leis (normas.leg.br)') }, c.articles, r.short);
    return { normId, short: r.short };
  }
}

async function resolveState(admin: SupabaseClient, n: UnlistedNorm, uf: string): Promise<Outcome> {
  if (!n.year) return { normId: null, detail: 'citação sem ano' };
  const c = await fromCtresb(uf, n, n.year);
  if (!c) return { normId: null, detail: `não está no acervo de ${uf}` };
  const r = resolvedNorm(n, n.year, uf, stateUrn(uf, n.kind, n.num, n.year), c.meta.ementa ?? '');
  const normId = await saveNorm(admin, {
    urn: r.urn, law_key: r.key, name: r.name, short_name: r.short, citation: r.citation, match_pattern: r.pattern,
    ...ctresbRow(c, `Assembleia Legislativa (${uf}), via acervo ctresb/leis`),
  }, c.articles, r.short);
  return { normId, short: r.short };
}

// Ato de órgão federal (IN RFB, Resolução CONAMA...): reguladores/<órgão>[/<tipo>]/<ano>, como saiu no Diário Oficial.
async function resolveInfra(admin: SupabaseClient, n: UnlistedNorm): Promise<Outcome> {
  const org = orgOf(n.org);
  if (!org || !n.year) return { normId: null, detail: n.year ? 'órgão desconhecido' : 'citação sem ano' };
  const base = `reguladores/${org.folder}`, sub = infraFolder(await ctresbList(base), n.kind);
  if (sub === undefined) return { normId: null, detail: `${org.acr} sem pasta deste tipo no acervo` };
  // O arquivo fica no ano da publicação: a norma de dezembro pode sair em janeiro.
  for (const y of [n.year, String(Number(n.year) + 1)]) {
    const dir = `${base}/${sub ? sub + '/' : ''}${y}`;
    for (const file of pickInfraFiles(await ctresbList(dir), n.kind, n.num).slice(0, 4)) {
      const c = await ctresbText(`${dir}/${file}`);
      const meta = c.meta as Record<string, string | undefined>;
      if (org.check && !org.name.test(`${meta.orgao ?? ''} ${meta.titulo ?? ''}`)) continue;
      if (!new RegExp(`\\b${n.year}\\b`).test(`${meta.data ?? ''} ${meta.titulo ?? ''} ${file}`)) continue;
      if (c.articles.length < 1) continue;
      const r = resolvedNorm(n, n.year, null, `ctresb:${org.folder}:${n.kind}:${n.num}:${n.year}`, (meta.ementa ?? firstLine(c.articles)) || '', org);
      const normId = await saveNorm(admin, {
        urn: r.urn, law_key: r.key, name: r.name, short_name: r.short, citation: r.citation, match_pattern: r.pattern,
        ...ctresbRow(c, 'Diário Oficial da União, via acervo ctresb/leis'),
      }, c.articles, r.short);
      return { normId, short: r.short };
    }
  }
  return { normId: null, detail: `não está no acervo de ${org.acr}` };
}
const firstLine = (a: LegalArticle[]) => a[0]?.text.split('\n')[0]?.replace(/^Art\. \S+\s*/, '').slice(0, 90) ?? '';

// Constituição Estadual (estaduais/UF/constituicao/<ano>) e Lei Orgânica (municipais/UF/<município>/lei-organica/<ano>):
// fica a versão mais recente.
async function resolveLocal(admin: SupabaseClient, l: LocalNorm): Promise<Outcome> {
  const base = l.kind === 'ce' ? `estaduais/${l.uf}/constituicao` : `municipais/${l.uf}/${slugOf(l.city!)}/lei-organica`;
  const year = (await ctresbList(base)).filter((y) => /^\d{4}$/.test(y)).sort().at(-1);
  const file = year && (await ctresbList(`${base}/${year}`)).find((f) => f.endsWith('.md'));
  if (!file) return { normId: null, detail: `não está no acervo (${base})` };
  const c = await ctresbText(`${base}/${year}/${file}`);
  if (c.articles.length < 5) return { normId: null, detail: 'texto sem artigos reconhecíveis' };
  const e = localEntry(l);
  const normId = await saveNorm(admin, {
    urn: e.urn, law_key: e.key, name: e.name, short_name: e.short, citation: e.name, match_pattern: e.pattern,
    ...ctresbRow(c, l.kind === 'ce' ? `Assembleia Legislativa (${l.uf}), via acervo ctresb/leis` : `Câmara Municipal de ${l.city}, via acervo ctresb/leis`),
  }, c.articles, e.short);
  return { normId, short: e.short };
}

// Onde procurar: a citação diz "Estadual"/"Federal"; sem isso, primeiro federal (o ano confirma) e depois a UF do
// edital. Sem ano e com UF, a estadual primeiro: "Lei 10.261" num edital do TJSP é o Estatuto paulista, não a federal.
function places(n: UnlistedNorm, uf: string | null): ('federal' | 'orgao' | string)[] {
  if (!(n.kind in SENADO_TYPE)) return ['orgao'];
  if (n.scope === 'estadual') return uf ? [uf] : [];
  if (n.scope === 'federal' || !uf) return ['federal'];
  return n.year ? ['federal', uf] : [uf, 'federal'];
}

// Busca com cache em legal_lookups. `run` devolve o resultado; erro de rede não grava (tenta na próxima montagem).
async function cached(admin: SupabaseClient, key: string, run: () => Promise<Outcome>): Promise<string | null | undefined> {
  const { data: prev } = await admin.from('legal_lookups').select('found, norm_id, checked_at').eq('key', key).maybeSingle();
  const fresh = prev && Date.now() - new Date(prev.checked_at).getTime() < MAX_AGE_MS;
  if (fresh && prev.found && prev.norm_id) return prev.norm_id as string;
  if (fresh && !prev.found) return null;
  let out: Outcome;
  try { out = await run(); } catch (e) { console.error('resolve-laws:', key, e); return undefined; }
  await admin.from('legal_lookups').upsert({ key, found: !!out.normId, norm_id: out.normId, detail: (out.normId ? out.short : out.detail).slice(0, 500), checked_at: new Date().toISOString() });
  return out.normId;
}

async function resolveOne(admin: SupabaseClient, n: UnlistedNorm, uf: string | null): Promise<boolean> {
  for (const where of places(n, uf)) {
    const key = `${where === 'federal' || where === 'orgao' ? where : where.toLowerCase()}:${n.key}`;
    const id = await cached(admin, key, () => where === 'federal' ? resolveFederal(admin, n) : where === 'orgao' ? resolveInfra(admin, n) : resolveState(admin, n, where));
    if (id) return true;
  }
  return false;
}

// Normas citadas nos textos (tópicos do edital) que faltam: busca até o prazo, 3 por vez. Devolve as achadas e as que
// continuam faltando (estas o estudante ainda pode enviar em PDF). `org`: órgão do edital (UF e município).
export async function resolveCitedNorms(admin: SupabaseClient, texts: string[], o: { org: string; uf: string | null; known: LawEntry[]; deadline: number }) {
  const text = texts.join('\n');
  const knownKeys = new Set(o.known.map((k) => k.key));
  type Job = { citation: string; run: () => Promise<boolean> };
  const jobs: Job[] = [
    ...unlistedNorms(text, o.known).filter(resolvable).map((n) => ({ citation: n.citation, run: () => resolveOne(admin, n, o.uf) })),
    ...localNormsCited(text, o.org).filter((l) => !knownKeys.has(localEntry(l).key)).map((l) => ({
      citation: localEntry(l).name, run: async () => !!(await cached(admin, `local:${localEntry(l).key}`, () => resolveLocal(admin, l))),
    })),
  ];
  const found: string[] = [], missing: string[] = [];
  await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, async () => {
    for (let j = jobs.shift(); j; j = jobs.shift()) {
      if (Date.now() > o.deadline) { missing.push(j.citation); continue; }
      (await j.run() ? found : missing).push(j.citation);
    }
  }));
  return { found, missing };
}
