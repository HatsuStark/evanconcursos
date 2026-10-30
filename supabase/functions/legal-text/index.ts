// Edge Function "legal-text": garante que as leis pedidas estão no banco (texto compilado do normas.leg.br,
// CC BY 4.0), separadas por artigo. POST {laws: ['CPP', 'CP', ...]} → {norms: [{key, id, version, fetchedAt}]}.
// Recarrega textos com mais de 30 dias. Marcações dos usuários são preservadas (upsert por rótulo).
import { parseLawHtml } from '../../../shared/legal/parse.ts';
import { lawByKey, type LawEntry } from '../../../shared/legal/registry.ts';
import { adminClient, CORS, json, requireUser } from '../_shared/http.ts';

const API = 'https://normas.leg.br/api/public';
const MAX_AGE_MS = 30 * 864e5;

type Encoding = { version?: string; contentUrl?: string; encodingFormat?: string };

async function ingest(admin: ReturnType<typeof adminClient>, law: LawEntry) {
  const meta = await (await fetch(`${API}/normas?urn=${encodeURIComponent(law.urn)}&tipo_documento=maior-detalhe`)).json() as { encoding?: Encoding[] };
  const html = (meta.encoding ?? []).filter((e) => e.contentUrl && /html/.test(e.encodingFormat ?? 'html'));
  const enc = html.find((e) => e.version === 'Current') ?? html[0];
  if (!enc?.contentUrl) throw new Error(`${law.short}: texto indisponível no normas.leg.br`);
  // O site deles troca /api/binario/ por /api/public/binario/ para o download público.
  const contentUrl = enc.contentUrl.replace('/api/binario/', '/api/public/binario/');
  const res = await fetch(contentUrl);
  if (!res.ok) throw new Error(`${law.short}: falha ao baixar o texto (${res.status})`);
  const articles = parseLawHtml(await res.text());
  if (articles.length < 3) throw new Error(`${law.short}: texto sem artigos reconhecíveis`);

  const { data: norm, error } = await admin.from('legal_norms').upsert({
    urn: law.urn, law_key: law.key, name: law.name, short_name: law.short, source_url: `https://normas.leg.br/?urn=${law.urn}`,
    content_url: contentUrl, version: enc.version === 'Current' ? 'Current' : 'Original', articles_count: articles.length, fetched_at: new Date().toISOString(),
  }, { onConflict: 'urn' }).select('id').single();
  if (error || !norm) throw new Error(`${law.short}: ${error?.message ?? 'falha ao gravar'}`);
  for (let i = 0; i < articles.length; i += 400) {
    const { error: e } = await admin.from('legal_articles').upsert(articles.slice(i, i + 400).map((a) => ({
      norm_id: norm.id, ord: a.ord, label: a.label, num: a.num, suffix: a.suffix, heading: a.heading, text: a.text, notes: a.notes, revoked: a.revoked,
    })), { onConflict: 'norm_id,label' });
    if (e) throw new Error(`${law.short}: ${e.message}`);
  }
  // Artigos que sumiram da compilação nova.
  const labels = new Set(articles.map((a) => a.label));
  const { data: old } = await admin.from('legal_articles').select('id, label').eq('norm_id', norm.id);
  const gone = (old ?? []).filter((o) => !labels.has(o.label)).map((o) => o.id);
  if (gone.length) await admin.from('legal_articles').delete().in('id', gone);
  return norm.id as string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
  const auth = await requireUser(req, { ai: false });
  if (auth instanceof Response) return auth;
  const body = await req.json().catch(() => ({}));
  const keys = [...new Set((Array.isArray(body.laws) ? body.laws : []).map(String))].slice(0, 6);
  const laws = keys.map((k) => lawByKey(k)).filter((l): l is LawEntry => !!l);
  if (!laws.length) return json(400, { error: 'Informe leis conhecidas.' });
  const admin = adminClient();
  const norms: { key: string; id?: string; version?: string; fetchedAt?: string; error?: string }[] = [];
  for (const law of laws) {
    try {
      const { data: cur } = await admin.from('legal_norms').select('id, version, fetched_at').eq('urn', law.urn).maybeSingle();
      if (cur && Date.now() - new Date(cur.fetched_at).getTime() < MAX_AGE_MS) { norms.push({ key: law.key, id: cur.id, version: cur.version, fetchedAt: cur.fetched_at }); continue; }
      const id = await ingest(admin, law);
      norms.push({ key: law.key, id, version: 'Current', fetchedAt: new Date().toISOString() });
    } catch (e) {
      norms.push({ key: law.key, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return json(200, { norms });
});
