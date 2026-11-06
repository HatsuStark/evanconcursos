// Cache compartilhado das leituras do edital (tabela notice_ai_cache; regras em shared/ai/notice-cache.ts).
import type { SupabaseClient } from '@supabase/supabase-js';
import { noticeDocKeys, noticeTitleKey, SAME_TEXT_SIMILARITY, signatureSimilarity, textSignature } from '../../../shared/ai/notice-cache.ts';

export type CacheKind = 'roles' | 'extract';
export interface CachedRead { result: unknown; raw: unknown; model: string }

export async function cachedRead(admin: SupabaseClient, kind: CacheKind, docKeys: string[], roleKey: string, version: string): Promise<CachedRead | null> {
  const { data, error } = await admin.from('notice_ai_cache').select('result, raw, model')
    .eq('kind', kind).in('doc_key', docKeys).eq('role_key', roleKey).eq('prompt_version', version).limit(1);
  if (error) { console.error('notice cache read:', error.message); return null; }
  return (data?.[0] as CachedRead | undefined) ?? null;
}

// Grava sob todas as chaves do edital (a que faltava ganha a leitura achada pela outra). Falha no cache não para a leitura.
export async function saveRead(admin: SupabaseClient, kind: CacheKind, docKeys: string[], roleKey: string, version: string, read: CachedRead) {
  const { error } = await admin.from('notice_ai_cache').upsert(
    docKeys.map((doc_key) => ({ kind, doc_key, role_key: roleKey, prompt_version: version, model: read.model, result: read.result, raw: read.raw ?? null })),
    { onConflict: 'kind,doc_key,role_key,prompt_version', ignoreDuplicates: true },
  );
  if (error) console.error('notice cache write:', error.message);
}

// ---------- reconhecimento do edital (chaves exatas, depois título + assinatura do texto) ----------

export interface NoticeDoc { keys: string[]; pdfKey: string; textKey: string | null; titleKey: string | null; signature: number[] | null }

export async function identifyNotice(bytes: Uint8Array, text: string | null): Promise<NoticeDoc> {
  const keys = await noticeDocKeys(bytes, text);
  return { keys, pdfKey: keys[0]!, textKey: keys[1] ?? null, titleKey: text ? await noticeTitleKey(text) : null, signature: text ? textSignature(text) : null };
}

// Editais já conhecidos com o mesmo título: o texto praticamente igual (mesmo edital em outro arquivo) ou só parecido
// (mesmo concurso com outro texto: retificação ou republicação).
async function sameTitle(admin: SupabaseClient, doc: NoticeDoc) {
  if (!doc.titleKey || !doc.signature) return [];
  const { data } = await admin.from('notice_docs').select('doc_key, text_key, signature').eq('title_key', doc.titleKey).neq('doc_key', doc.pdfKey).limit(20);
  return ((data ?? []) as { doc_key: string; text_key: string | null; signature: number[] | null }[])
    .map((r) => ({ ...r, similarity: r.signature ? signatureSimilarity(doc.signature!, r.signature) : 0 }));
}

// Leitura já feita: pelas chaves exatas e, sem elas, pelo mesmo edital em outro arquivo (`fuzzy`: o candidato confere
// datas e vagas, porque uma retificação pequena também passa por aqui).
export async function findRead(admin: SupabaseClient, kind: CacheKind, doc: NoticeDoc, roleKey: string, version: string): Promise<{ read: CachedRead; fuzzy: boolean } | null> {
  const exact = await cachedRead(admin, kind, doc.keys, roleKey, version);
  if (exact) return { read: exact, fuzzy: false };
  const near = (await sameTitle(admin, doc)).filter((r) => r.similarity >= SAME_TEXT_SIMILARITY).flatMap((r) => [r.doc_key, r.text_key].filter((k): k is string => !!k));
  if (!near.length) return null;
  const read = await cachedRead(admin, kind, near, roleKey, version);
  return read ? { read, fuzzy: true } : null;
}

// Grava o edital entre os conhecidos e devolve a versão anterior do mesmo concurso, se houver: mesmo título com texto
// diferente o bastante para não ser o mesmo arquivo (retificação ou republicação). Base do aviso de retificação.
export async function registerNotice(admin: SupabaseClient, doc: NoticeDoc): Promise<string | null> {
  const others = await sameTitle(admin, doc);
  const previous = others.filter((r) => r.similarity < SAME_TEXT_SIMILARITY && r.similarity >= RELATED_TEXT_SIMILARITY).sort((a, b) => b.similarity - a.similarity)[0]?.doc_key ?? null;
  const { error } = await admin.from('notice_docs').upsert({ doc_key: doc.pdfKey, text_key: doc.textKey, title_key: doc.titleKey, signature: doc.signature, previous_doc_key: previous }, { onConflict: 'doc_key', ignoreDuplicates: true });
  if (error) console.error('notice_docs:', error.message);
  return previous;
}
// Abaixo disso, mesmo título é coincidência (outro concurso com cabeçalho parecido).
export const RELATED_TEXT_SIMILARITY = 0.5;
