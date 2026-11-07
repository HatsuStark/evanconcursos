// Fontes legais de um tema: artigos gravados na sessão na montagem do plano (law_refs); sem eles (plano antigo), os
// citados no título (ou, sem intervalo ali, nos tópicos do edital).
import type { SupabaseClient } from '@supabase/supabase-js';
import { sourceRef } from '../../../shared/ai/guide.ts';
import { inRanges, rangesOrFilter, resolveSessionRefs, type LawRef } from '../../../shared/legal/refs.ts';
import { lawByKey, type LawEntry } from '../../../shared/legal/registry.ts';
import { selectArticles } from '../../../shared/legal/select.ts';
import { ownLaws } from './legal.ts';

export const MAX_ARTICLES = 25;

export interface LoadedArticle { lawKey: string; label: string; num: number; suffix: string; text: string; heading: string }
// Sessão com mais artigos do que cabem: rótulos dos artigos mais cobrados (levantamento da IA, em cache), para a escolha.
export type HotLookup = (refs: LawRef[], articles: LoadedArticle[], extra: LawEntry[]) => Promise<string[]>;

// ownerId: inclui as normas que o estudante enviou em PDF (devolvidas em `extra`, para conferir as citações).
// omitted: seções da lei da sessão que ficaram sem artigo nos trechos (o estudante as lê na lei seca).
export async function loadLawSources(admin: SupabaseClient, p: { title: string; topics: string[]; subject: string; ownerId?: string; lawRefs?: unknown; hot?: HotLookup }) {
  const extra: LawEntry[] = p.ownerId ? await ownLaws(admin, p.ownerId) : [];
  // Sem artigos gravados, o título manda; o item do edital (que junta leis de várias sessões) só completa quando bate com ele.
  const refs = resolveSessionRefs(p.lawRefs, p.title, p.topics, p.subject, extra).slice(0, 4).filter((x) => x.ranges.length);
  const provided: LoadedArticle[] = [];
  for (const r of refs) {
    const law = lawByKey(r.law, extra);
    if (!law) continue;
    const { data: norm } = await admin.from('legal_norms').select('id').eq('urn', law.urn).maybeSingle();
    if (!norm) continue;
    const { data: arts } = await admin.from('legal_articles').select('label, num, suffix, text, heading').eq('norm_id', norm.id).eq('revoked', false)
      .or(rangesOrFilter(r.ranges)).order('ord').limit(400);
    provided.push(...(arts ?? []).filter((a) => inRanges(r.ranges, a.num, a.suffix)).map((a) => ({ lawKey: r.law, ...a, heading: a.heading ?? '' })));
  }
  // Cabe tudo: todos. Senão, todos os assuntos da sessão (não só os primeiros artigos), puxando os mais cobrados.
  let articles = provided, omitted: string[] = [];
  if (provided.length > MAX_ARTICLES) {
    const hot = p.hot ? await p.hot(refs, provided, extra).catch((e) => { console.error('mais cobrados:', e); return []; }) : [];
    const hotKeys = new Set(hot);
    ({ picked: articles, omitted } = selectArticles(provided.map((a) => ({ ...a, hot: hotKeys.has(`${a.lawKey}:${a.label}`) })), MAX_ARTICLES, { title: p.title, topics: p.topics }));
  }
  return { articles, extra, omitted, refs, all: provided, law: articles.map((a) => ({ ref: sourceRef(a.lawKey, a.label, extra), text: a.text.slice(0, 1500) })) };
}
