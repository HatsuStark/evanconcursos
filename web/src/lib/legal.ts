// Lei seca: leis citadas pela sessão, artigos (texto oficial compartilhado) e marcações pessoais.
import { useQuery } from '@tanstack/react-query';
import { findLawRefs, inRanges, type LawRef } from '../../../shared/legal/refs.ts';
import { lawByKey } from '../../../shared/legal/registry.ts';
import { supabase } from './supabase.ts';

export interface Norm { id: string; law_key: string; name: string; short_name: string; source_url: string; version: 'Current' | 'Original'; fetched_at: string }
export interface Article { id: string; ord: number; label: string; num: number; suffix: string; heading: string; text: string; notes: string[]; revoked: boolean }
export interface Mark { id: string; article_id: string; color: string; note: string }

// Leis da sessão: as citadas no título (mais específicas); se não houver artigos ali, as dos tópicos do edital.
export function sessionLawRefs(title: string, topics: string[], subject: string): LawRef[] {
  const fromTitle = findLawRefs(title, subject);
  if (fromTitle.some((r) => r.ranges.length)) return fromTitle;
  const fromTopics = findLawRefs(topics.join('\n'), subject);
  return fromTopics.length ? fromTopics : fromTitle;
}

export const rangesLabel = (r: LawRef) => r.ranges.length
  ? (r.ranges.length === 1 && r.ranges[0]!.from === r.ranges[0]!.to ? 'art. ' : 'arts. ') + r.ranges.map((x) => x.from === x.to ? `${x.from}${x.fromSuffix ? '-' + x.fromSuffix : ''}` : `${x.from} a ${x.to}`).join(', ')
  : 'lei completa';

// Garante a lei no banco (a função legal-text busca no normas.leg.br na primeira vez) e devolve os artigos.
export const useLawArticles = (ref: LawRef | null) => useQuery({
  queryKey: ['law', ref?.law, JSON.stringify(ref?.ranges ?? [])],
  enabled: !!ref,
  staleTime: 10 * 60_000,
  queryFn: async (): Promise<{ norm: Norm; articles: Article[] }> => {
    const law = lawByKey(ref!.law)!;
    const pick = async () => (await supabase.from('legal_norms').select('id, law_key, name, short_name, source_url, version, fetched_at').eq('urn', law.urn).maybeSingle()).data as Norm | null;
    let norm = await pick();
    if (!norm) {
      const { data, error } = await supabase.functions.invoke('legal-text', { body: { laws: [law.key] } });
      const err = (data as { norms?: { error?: string }[] } | null)?.norms?.[0]?.error;
      if (error || err) throw new Error(err ?? error?.message ?? 'Falha ao carregar a lei.');
      norm = await pick();
      if (!norm) throw new Error('Lei indisponível.');
    }
    let q = supabase.from('legal_articles').select('id, ord, label, num, suffix, heading, text, notes, revoked').eq('norm_id', norm.id).order('ord').limit(3000);
    if (ref!.ranges.length) q = q.gte('num', Math.min(...ref!.ranges.map((r) => r.from))).lte('num', Math.max(...ref!.ranges.map((r) => r.to)));
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { norm, articles: (data as Article[]).filter((a) => inRanges(ref!.ranges, a.num, a.suffix)) };
  },
});

export const useMarks = (articleIds: string[]) => useQuery({
  queryKey: ['marks', articleIds.join(',')],
  enabled: articleIds.length > 0,
  queryFn: async () => {
    const out: Mark[] = [];
    for (let i = 0; i < articleIds.length; i += 200) {
      const { data, error } = await supabase.from('legal_marks').select('id, article_id, color, note').in('article_id', articleIds.slice(i, i + 200));
      if (error) throw new Error(error.message);
      out.push(...(data as Mark[]));
    }
    return out;
  },
});

export async function saveMark(articleId: string, color: string | null, note: string) {
  if (!color && !note.trim()) {
    const { error } = await supabase.from('legal_marks').delete().eq('article_id', articleId);
    if (error) throw new Error(error.message);
    return;
  }
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from('legal_marks').upsert({ owner_id: u.user?.id, article_id: articleId, color: color ?? 'yellow', note: note.slice(0, 2000), updated_at: new Date().toISOString() }, { onConflict: 'owner_id,article_id' });
  if (error) throw new Error(error.message);
}
