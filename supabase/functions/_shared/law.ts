// Fontes legais de um tema: artigos citados no título da sessão (ou, sem intervalo ali, nos tópicos do edital).
import type { SupabaseClient } from '@supabase/supabase-js';
import { sourceRef } from '../../../shared/ai/guide.ts';
import { findLawRefs, inRanges } from '../../../shared/legal/refs.ts';
import { lawByKey } from '../../../shared/legal/registry.ts';

export const MAX_ARTICLES = 25;

export async function loadLawSources(admin: SupabaseClient, p: { title: string; topics: string[]; subject: string }) {
  let refs = findLawRefs(p.title, p.subject).filter((r) => r.ranges.length);
  if (!refs.length) refs = findLawRefs(p.topics.join('\n'), p.subject).filter((r) => r.ranges.length);
  const provided: { lawKey: string; label: string; num: number; suffix: string; text: string }[] = [];
  for (const r of refs.slice(0, 4)) {
    const law = lawByKey(r.law);
    if (!law) continue;
    const { data: norm } = await admin.from('legal_norms').select('id').eq('urn', law.urn).maybeSingle();
    if (!norm) continue;
    const { data: arts } = await admin.from('legal_articles').select('label, num, suffix, text').eq('norm_id', norm.id).eq('revoked', false)
      .gte('num', Math.min(...r.ranges.map((x) => x.from))).lte('num', Math.max(...r.ranges.map((x) => x.to))).order('ord').limit(200);
    provided.push(...(arts ?? []).filter((a) => inRanges(r.ranges, a.num, a.suffix)).map((a) => ({ lawKey: r.law, ...a })));
  }
  const articles = provided.slice(0, MAX_ARTICLES);
  return { articles, law: articles.map((p) => ({ ref: sourceRef(p.lawKey, p.label), text: p.text.slice(0, 1500) })) };
}
