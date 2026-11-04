// Texto compilado das leis do registro (normas.leg.br, CC BY 4.0), separado por artigo e gravado no banco. Usado pela
// função legal-text (lei seca) e pelo plan-design (medir as sessões de cada lei ao montar o cronograma).
// Normas com `pdf` (ex.: Normas da CGJ) não estão no normas.leg.br: carregadas pelo scripts/legal-seed.ts.
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseLawHtml } from '../../../shared/legal/parse.ts';
import type { LawEntry } from '../../../shared/legal/registry.ts';

const API = 'https://normas.leg.br/api/public';
export const MAX_AGE_MS = 30 * 864e5;

type Encoding = { version?: string; contentUrl?: string; encodingFormat?: string };

export async function ingestLaw(admin: SupabaseClient, law: LawEntry) {
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


// Id da norma no banco; lei do registro que ainda não está lá é baixada agora. Null se não der (sem texto, PDF não
// carregado, falha de rede): quem chama segue sem ela.
export async function ensureLaw(admin: SupabaseClient, law: LawEntry): Promise<string | null> {
  const { data: cur } = await admin.from('legal_norms').select('id').eq('urn', law.urn).maybeSingle();
  if (cur) return cur.id as string;
  if (law.pdf) return null;
  try { return await ingestLaw(admin, law); } catch (e) { console.error('ensureLaw:', law.key, e); return null; }
}
