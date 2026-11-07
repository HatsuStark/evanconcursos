// Lei seca: leis citadas pela sessão, artigos (texto oficial compartilhado) e marcações pessoais.
import { useQuery } from '@tanstack/react-query';
import { findLawRefs, inRanges, rangesLabel, rangesOrFilter, sessionLawRefs as lawRefsOfSession, storedLawRefs, type LawRef } from '../../../shared/legal/refs.ts';
import { ownLawEntry, unlistedNorms, type OwnNormRow, type UnlistedNorm } from '../../../shared/legal/norms.ts';
import { lawByKey, type LawEntry } from '../../../shared/legal/registry.ts';
import { supabase } from './supabase.ts';

export interface Norm { id: string; law_key: string; name: string; short_name: string; source_url: string; version: 'Current' | 'Original'; fetched_at: string; owner_id?: string | null; license?: string }
export interface Article { id: string; ord: number; label: string; num: number; suffix: string; heading: string; text: string; notes: string[]; revoked: boolean }
export interface Mark { id: string; article_id: string; color: string; note: string }

// Leis da sessão: a mesma regra das questões e da apostila (os artigos gravados na montagem; sem eles, o título manda e o
// item do edital só completa quando bate com ele). Sem artigos, a lei citada no título (ou a principal da matéria) inteira.
export function sessionLawRefs(title: string, topics: string[], subject: string, own: LawEntry[] = [], stored?: unknown): LawRef[] {
  const saved = storedLawRefs(stored);
  if (saved) return saved;
  const refs = lawRefsOfSession(title, topics, subject, own);
  return refs.length ? refs : findLawRefs(title, subject, own);
}

// Normas citadas no título da sessão que não estão no app (nem no registro, nem enviadas pelo estudante). O item do
// edital fica de fora: ele junta normas de várias sessões, e pedir todas aqui confundiria.
export const missingNorms = (title: string, own: LawEntry[]): UnlistedNorm[] => unlistedNorms(title, own);

// Normas fora do registro, como entradas de registro: as que o estudante enviou em PDF (só dele; `rows`) e as achadas
// nos editais (sem dono, para todos).
export interface OwnNorm extends OwnNormRow { id: string; citation: string; articles_count: number; source_url: string; fetched_at: string; owner_id: string | null }
export const useOwnLaws = () => useQuery({
  queryKey: ['own-laws'],
  staleTime: 5 * 60_000,
  queryFn: async () => {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id ?? '';
    const { data, error } = await supabase.from('legal_norms').select('id, law_key, short_name, name, urn, match_pattern, citation, articles_count, source_url, fetched_at, owner_id')
      .or(`owner_id.eq.${uid},and(owner_id.is.null,match_pattern.not.is.null)`).order('fetched_at').limit(500);
    if (error) throw new Error(error.message);
    const all = data as OwnNorm[];
    return { rows: all.filter((r) => r.owner_id === uid), entries: all.map(ownLawEntry).filter((l): l is LawEntry => !!l) };
  },
});

// Envia o PDF da norma (pasta do estudante no bucket "leis") e separa os artigos no servidor.
export async function uploadLawPdf(file: File, citation: string, key: string) {
  if (file.type && file.type !== 'application/pdf') throw new Error('Envie um arquivo PDF.');
  if (file.size > 50 * 1024 * 1024) throw new Error('PDF maior que 50 MB.');
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error('Entre na sua conta.');
  const path = `${u.user.id}/${key}.pdf`;
  const up = await supabase.storage.from('leis').upload(path, file, { contentType: 'application/pdf', upsert: true });
  if (up.error) throw new Error(`Falha ao enviar o PDF: ${up.error.message}`);
  const { data, error } = await supabase.functions.invoke('law-upload', { body: { path, citation } });
  const err = (data as { error?: string } | null)?.error;
  if (error || err) {
    // A função devolve a mensagem no corpo mesmo com status de erro.
    const ctx = (error as { context?: Response } | null)?.context;
    const body = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) as { error?: string } | null : null;
    throw new Error(err ?? body?.error ?? error?.message ?? 'Não foi possível ler o PDF.');
  }
  return (data as { norm: { short: string; articles: number; first: string; last: string } }).norm;
}

export async function deleteOwnLaw(n: OwnNorm) {
  const { error } = await supabase.from('legal_norms').delete().eq('id', n.id);
  if (error) throw new Error(error.message);
  await supabase.storage.from('leis').remove([n.source_url]);
}
export { rangesLabel };

// Garante a lei no banco (a função legal-text busca no normas.leg.br na primeira vez) e devolve os artigos.
export const useLawArticles = (ref: LawRef | null, own: LawEntry[] = []) => useQuery({
  queryKey: ['law', ref?.law, JSON.stringify(ref?.ranges ?? [])],
  enabled: !!ref,
  staleTime: 10 * 60_000,
  queryFn: async (): Promise<{ norm: Norm; articles: Article[]; span: { first: Pick<Article, 'label' | 'num'>; last: Pick<Article, 'label' | 'num'> } | null }> => {
    const law = lawByKey(ref!.law, own);
    if (!law) throw new Error('Lei indisponível.');
    const pick = async () => (await supabase.from('legal_norms').select('id, law_key, name, short_name, source_url, version, fetched_at, owner_id, license').eq('urn', law.urn).maybeSingle()).data as Norm | null;
    let norm = await pick();
    if (!norm && law.urn.startsWith('upload:')) throw new Error('Norma enviada não encontrada. Envie o PDF de novo.');
    if (!norm && !law.urn.startsWith('urn:lex:')) throw new Error('Texto da norma indisponível.');
    if (!norm) {
      const { data, error } = await supabase.functions.invoke('legal-text', { body: { laws: [law.key] } });
      const err = (data as { norms?: { error?: string }[] } | null)?.norms?.[0]?.error;
      if (error || err) throw new Error(err ?? error?.message ?? 'Falha ao carregar a lei.');
      norm = await pick();
      if (!norm) throw new Error('Lei indisponível.');
    }
    let q = supabase.from('legal_articles').select('id, ord, label, num, suffix, heading, text, notes, revoked').eq('norm_id', norm.id).order('ord').limit(3000);
    if (ref!.ranges.length) q = q.or(rangesOrFilter(ref!.ranges));
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    // Norma enviada pelo estudante: primeiro e último artigo do PDF, para avisar quando ele é só um trecho.
    let span = null;
    if (norm.owner_id) {
      const edge = (asc: boolean) => supabase.from('legal_articles').select('label, num').eq('norm_id', norm!.id).order('ord', { ascending: asc }).limit(1).maybeSingle();
      const [{ data: first }, { data: last }] = await Promise.all([edge(true), edge(false)]);
      if (first && last) span = { first: first as Pick<Article, 'label' | 'num'>, last: last as Pick<Article, 'label' | 'num'> };
    }
    return { norm, articles: (data as Article[]).filter((a) => inRanges(ref!.ranges, a.num, a.suffix)), span };
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
