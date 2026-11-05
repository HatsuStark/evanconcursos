// Texto compilado das leis do registro (normas.leg.br, CC BY 4.0), separado por artigo e gravado no banco. Usado pela
// função legal-text (lei seca) e pelo plan-design (medir as sessões de cada lei ao montar o cronograma).
// Normas com `pdf` (ex.: Normas da CGJ) não estão no normas.leg.br: carregadas pelo scripts/legal-seed.ts.
// Normas citadas no edital fora do registro são achadas por resolve-laws.ts e gravadas com match_pattern, sem dono.
import type { SupabaseClient } from '@supabase/supabase-js';
import { type LegalArticle, parseLawHtml } from '../../../shared/legal/parse.ts';
import type { LawEntry } from '../../../shared/legal/registry.ts';
import { ownLawEntry, type OwnNormRow } from '../../../shared/legal/norms.ts';

const API = 'https://normas.leg.br/api/public';
export const MAX_AGE_MS = 30 * 864e5;

type Encoding = { version?: string; contentUrl?: string; encodingFormat?: string };
type LawId = Pick<LawEntry, 'key' | 'short' | 'name' | 'urn'>;

// Grava (ou atualiza) a norma e os artigos; artigos que sumiram do texto novo saem. Marcações ficam (upsert por rótulo).
export async function saveNorm(admin: SupabaseClient, row: Record<string, unknown> & { urn: string }, articles: LegalArticle[], label: string) {
  const { data: norm, error } = await admin.from('legal_norms').upsert({ ...row, articles_count: articles.length, fetched_at: new Date().toISOString() }, { onConflict: 'urn' }).select('id').single();
  if (error || !norm) throw new Error(`${label}: ${error?.message ?? 'falha ao gravar'}`);
  for (let i = 0; i < articles.length; i += 400) {
    const { error: e } = await admin.from('legal_articles').upsert(articles.slice(i, i + 400).map((a) => ({
      norm_id: norm.id, ord: a.ord, label: a.label, num: a.num, suffix: a.suffix, heading: a.heading, text: a.text, notes: a.notes, revoked: a.revoked,
    })), { onConflict: 'norm_id,label' });
    if (e) throw new Error(`${label}: ${e.message}`);
  }
  const labels = new Set(articles.map((a) => a.label));
  const { data: old } = await admin.from('legal_articles').select('id, label').eq('norm_id', norm.id);
  const gone = (old ?? []).filter((o) => !labels.has(o.label)).map((o) => o.id);
  if (gone.length) await admin.from('legal_articles').delete().in('id', gone);
  return norm.id as string;
}

// `extra`: colunas a mais da norma (match_pattern e citation, nas achadas pelo edital).
export async function ingestLaw(admin: SupabaseClient, law: LawId, extra: Record<string, unknown> = {}) {
  const meta = await (await fetch(`${API}/normas?urn=${encodeURIComponent(law.urn)}&tipo_documento=maior-detalhe`, { signal: AbortSignal.timeout(20_000) })).json() as { encoding?: Encoding[] };
  const html = (meta.encoding ?? []).filter((e) => e.contentUrl && /html/.test(e.encodingFormat ?? 'html'));
  const enc = html.find((e) => e.version === 'Current') ?? html[0];
  if (!enc?.contentUrl) throw new Error(`${law.short}: texto indisponível no normas.leg.br`);
  // O site deles troca /api/binario/ por /api/public/binario/ para o download público.
  const contentUrl = enc.contentUrl.replace('/api/binario/', '/api/public/binario/');
  const res = await fetch(contentUrl, { signal: AbortSignal.timeout(40_000) });
  if (!res.ok) throw new Error(`${law.short}: falha ao baixar o texto (${res.status})`);
  const articles = parseLawHtml(await res.text());
  if (articles.length < 3) throw new Error(`${law.short}: texto sem artigos reconhecíveis`);
  return saveNorm(admin, {
    urn: law.urn, law_key: law.key, name: law.name, short_name: law.short, source_url: `https://normas.leg.br/?urn=${law.urn}`,
    content_url: contentUrl, version: enc.version === 'Current' ? 'Current' : 'Original', ...extra,
  }, articles, law.short);
}

// Id da norma no banco; lei do registro que ainda não está lá é baixada agora. Null se não der (sem texto, PDF não
// carregado, falha de rede): quem chama segue sem ela.
export async function ensureLaw(admin: SupabaseClient, law: LawEntry): Promise<string | null> {
  const { data: cur } = await admin.from('legal_norms').select('id').eq('urn', law.urn).maybeSingle();
  if (cur) return cur.id as string;
  // Só as do LexML se baixam aqui; PDF, enviada pelo estudante e acervo estadual têm caminho próprio.
  if (law.pdf || !law.urn.startsWith('urn:lex:')) return null;
  try { return await ingestLaw(admin, law); } catch (e) { console.error('ensureLaw:', law.key, e); return null; }
}

// Normas fora do registro que valem para o estudante: as que ele enviou em PDF (só dele) e as achadas nos editais
// (sem dono, para todos), como entradas de registro.
export async function ownLaws(admin: SupabaseClient, ownerId: string): Promise<LawEntry[]> {
  const { data } = await admin.from('legal_norms').select('law_key, short_name, name, urn, match_pattern')
    .or(`owner_id.eq.${ownerId},and(owner_id.is.null,match_pattern.not.is.null)`).limit(500);
  return ((data ?? []) as OwnNormRow[]).map(ownLawEntry).filter((l): l is LawEntry => !!l);
}
