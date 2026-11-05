// Cache compartilhado das leituras do edital (tabela notice_ai_cache; regras em shared/ai/notice-cache.ts).
import type { SupabaseClient } from '@supabase/supabase-js';

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
