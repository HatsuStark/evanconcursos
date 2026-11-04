// Fontes legais de um tema: artigos citados no título da sessão (ou, sem intervalo ali, nos tópicos do edital).
import type { SupabaseClient } from '@supabase/supabase-js';
import { sourceRef } from '../../../shared/ai/guide.ts';
import { inRanges, sessionLawRefs } from '../../../shared/legal/refs.ts';
import { lawByKey, type LawEntry } from '../../../shared/legal/registry.ts';
import { ownLaws } from './legal.ts';

export const MAX_ARTICLES = 25;

// ownerId: inclui as normas que o estudante enviou em PDF (devolvidas em `extra`, para conferir as citações).
export async function loadLawSources(admin: SupabaseClient, p: { title: string; topics: string[]; subject: string; ownerId?: string }) {
  const extra: LawEntry[] = p.ownerId ? await ownLaws(admin, p.ownerId) : [];
  // O título manda; o item do edital (que junta leis de várias sessões) só completa quando bate com ele.
  const refs = sessionLawRefs(p.title, p.topics, p.subject, extra);
  const provided: { lawKey: string; label: string; num: number; suffix: string; text: string }[] = [];
  for (const r of refs.slice(0, 4)) {
    const law = lawByKey(r.law, extra);
    if (!law) continue;
    const { data: norm } = await admin.from('legal_norms').select('id').eq('urn', law.urn).maybeSingle();
    if (!norm) continue;
    const { data: arts } = await admin.from('legal_articles').select('label, num, suffix, text').eq('norm_id', norm.id).eq('revoked', false)
      .gte('num', Math.min(...r.ranges.map((x) => x.from))).lte('num', Math.max(...r.ranges.map((x) => x.to))).order('ord').limit(200);
    provided.push(...(arts ?? []).filter((a) => inRanges(r.ranges, a.num, a.suffix)).map((a) => ({ lawKey: r.law, ...a })));
  }
  const articles = provided.slice(0, MAX_ARTICLES);
  return { articles, extra, law: articles.map((p) => ({ ref: sourceRef(p.lawKey, p.label, extra), text: p.text.slice(0, 1500) })) };
}
