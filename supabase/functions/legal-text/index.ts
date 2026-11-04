// Edge Function "legal-text": garante que as leis pedidas estão no banco (texto compilado do normas.leg.br,
// CC BY 4.0), separadas por artigo. POST {laws: ['CPP', 'CP', ...]} → {norms: [{key, id, version, fetchedAt}]}.
// Recarrega textos com mais de 30 dias. Marcações dos usuários são preservadas (upsert por rótulo).
import { lawByKey, type LawEntry } from '../../../shared/legal/registry.ts';
import { adminClient, CORS, json, requireUser } from '../_shared/http.ts';
import { ingestLaw, MAX_AGE_MS } from '../_shared/legal.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
  const auth = await requireUser(req, { ai: false });
  if (auth instanceof Response) return auth;
  const body = await req.json().catch(() => ({}));
  const keys = [...new Set<string>((Array.isArray(body.laws) ? body.laws as unknown[] : []).map((k) => String(k)))].slice(0, 6);
  const laws = keys.map((k) => lawByKey(k)).filter((l): l is LawEntry => !!l);
  if (!laws.length) return json(400, { error: 'Informe leis conhecidas.' });
  const admin = adminClient();
  const norms: { key: string; id?: string; version?: string; fetchedAt?: string; error?: string }[] = [];
  for (const law of laws) {
    try {
      const { data: cur } = await admin.from('legal_norms').select('id, version, fetched_at').eq('urn', law.urn).maybeSingle();
      // Norma fora do normas.leg.br (PDF oficial): carregada e atualizada pelo scripts/legal-seed.ts.
      if (law.pdf) { norms.push(cur ? { key: law.key, id: cur.id, version: cur.version, fetchedAt: cur.fetched_at } : { key: law.key, error: `${law.short}: texto ainda não carregado.` }); continue; }
      if (cur && Date.now() - new Date(cur.fetched_at).getTime() < MAX_AGE_MS) { norms.push({ key: law.key, id: cur.id, version: cur.version, fetchedAt: cur.fetched_at }); continue; }
      const id = await ingestLaw(admin, law);
      norms.push({ key: law.key, id, version: 'Current', fetchedAt: new Date().toISOString() });
    } catch (e) {
      norms.push({ key: law.key, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return json(200, { norms });
});
