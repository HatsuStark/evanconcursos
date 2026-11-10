// Fontes de um tema sem lei: trechos de obras abertas (busca + escolha da IA) e livros de referência conferidos no Google
// Books, com cache compartilhado (source_picks). Usado pela aba Fontes e pela apostila das matérias sem lei.
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateJson, GeminiError } from '../../../shared/ai/gemini.ts';
import { normalizeText } from '../../../shared/ai/notice.ts';
import { sha256Hex } from '../../../shared/ai/notice-cache.ts';
import {
  BOOKS_PROMPT_VERSION, BookSuggestions, bookMatches, booksPrompt, bookSuggestionsJsonSchema, MAX_BOOKS, MAX_SOURCE_CANDIDATES, mergeSourcePicks, SOURCES_PROMPT_VERSION,
  SourcePicks, sourcePicksJsonSchema, sourcesPrompt, sourcesQuery, type BookRef, type SourceCandidate, type SourceItem, type SourceMeta,
} from '../../../shared/ai/sources.ts';
import { sourcesForSubject } from '../../../shared/sources/catalog.ts';
import { defaultModel, keyFor } from './ai.ts';
import { logUsage } from './http.ts';

export interface SourcesTopic { subject: string; title: string; keyword: string; topics: string[] }
type Admin = SupabaseClient;

async function cached<T>(admin: Admin, key: string, version: string) {
  const { data } = await admin.from('source_picks').select('result').eq('cache_key', key).eq('prompt_version', version).maybeSingle();
  return (data?.result ?? null) as T | null;
}
const store = (admin: Admin, key: string, version: string, model: string, result: unknown) =>
  admin.from('source_picks').upsert({ cache_key: key, prompt_version: version, model, result }, { onConflict: 'cache_key,prompt_version' });

async function ask<T>(admin: Admin, ownerId: string, operation: string, version: string, run: (model: string) => ReturnType<typeof generateJson>): Promise<T | null> {
  const model = defaultModel(), started = Date.now();
  try {
    const r = await run(model);
    await logUsage(admin, { ownerId, operation, model, promptVersion: version, usage: r.usage, latencyMs: Date.now() - started, status: 'ok' });
    return r.data as T;
  } catch (err) {
    await logUsage(admin, { ownerId, operation, model, promptVersion: version, usage: err instanceof GeminiError ? err.usage : null, latencyMs: Date.now() - started, status: 'error', error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// Trechos de fontes abertas que explicam o tema. ai = a escolha da IA está aplicada (com a frase do que cada um explica).
export async function topicSources(admin: Admin, ownerId: string, t: SourcesTopic, canGenerate: () => Promise<boolean>) {
  const keys = sourcesForSubject(t.subject), query = sourcesQuery(t.title, t.keyword);
  if (!keys.length || !query) return { items: [] as SourceItem[], sources: [] as SourceMeta[], ai: false };
  const [{ data: found, error }, { data: metas }] = await Promise.all([
    admin.rpc('search_open_chunks', { p_query: query, p_sources: keys, p_limit: MAX_SOURCE_CANDIDATES }),
    admin.from('open_sources').select('key, title, authors, license, license_url, url, note, commercial_ok').in('key', keys),
  ]);
  if (error) throw new Error(`fontes: ${error.message}`);
  const candidates = (found ?? []) as SourceCandidate[], sources = (metas ?? []) as SourceMeta[];
  const titleOf = (k: string) => sources.find((s) => s.key === k)?.title ?? k;
  if (!candidates.length) return { items: [], sources, ai: false };
  const key = await sha256Hex(JSON.stringify([normalizeText(t.subject), normalizeText(t.title), candidates.map((c) => c.id)]));
  let picks = await cached<SourcePicks>(admin, key, SOURCES_PROMPT_VERSION);
  if (!picks && await canGenerate()) {
    picks = await ask<SourcePicks>(admin, ownerId, 'source_picks', SOURCES_PROMPT_VERSION, (model) => generateJson({
      apiKey: keyFor(model), model, schema: SourcePicks, jsonSchema: sourcePicksJsonSchema(), temperature: 0.1, thinkingLevel: 'low', timeoutMs: 45_000,
      parts: [{ text: sourcesPrompt({ subject: t.subject, title: t.title, topics: t.topics, items: candidates.map((c) => ({ ...c, sourceTitle: titleOf(c.source_key) })) }) }],
    }));
    if (picks) await store(admin, key, SOURCES_PROMPT_VERSION, defaultModel(), picks);
  }
  const used = new Set<string>(), items = mergeSourcePicks(candidates, picks, titleOf);
  for (const i of items) used.add(i.source_key);
  return { items, sources: sources.filter((s) => used.has(s.key)), ai: !!picks };
}

// Livros de referência: a IA sugere, o Google Books confirma (título e autor) e dá editora, ano e link. Só os
// confirmados aparecem. Sem a Books API (chave ausente ou desativada), nada aparece e a sugestão fica guardada para a
// próxima vez, sem nova chamada à IA.
type BooksCache = { suggested: BookSuggestions; verified?: BookRef[] };
export async function topicBooks(admin: Admin, ownerId: string, t: { subject: string; title: string }, canGenerate: () => Promise<boolean>): Promise<BookRef[]> {
  const apiKey = Deno.env.get('GOOGLE_BOOKS_API_KEY') || Deno.env.get('YOUTUBE_API_KEY') || '';
  const key = await sha256Hex(JSON.stringify([normalizeText(t.subject), normalizeText(t.title)]));
  const hit = await cached<BooksCache>(admin, key, BOOKS_PROMPT_VERSION);
  if (hit?.verified) return hit.verified;
  let suggested = hit?.suggested ?? null;
  if (!suggested) {
    if (!await canGenerate()) return [];
    suggested = await ask<BookSuggestions>(admin, ownerId, 'book_refs', BOOKS_PROMPT_VERSION, (model) => generateJson({
      apiKey: keyFor(model), model, schema: BookSuggestions, jsonSchema: bookSuggestionsJsonSchema(), temperature: 0.1, thinkingLevel: 'low', timeoutMs: 30_000,
      parts: [{ text: booksPrompt(t) }],
    }));
    if (!suggested) return [];
    await store(admin, key, BOOKS_PROMPT_VERSION, defaultModel(), { suggested });
  }
  if (!apiKey) return [];
  const verified: BookRef[] = [];
  for (const s of suggested.livros.slice(0, MAX_BOOKS + 2)) {
    if (verified.length >= MAX_BOOKS) break;
    const q = `intitle:${s.titulo} inauthor:${s.autor}`;
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=5&printType=books&key=${apiKey}`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (!res?.ok) { console.error('google books:', res?.status); return []; } // API desativada ou cota: tenta de novo depois
    const body = await res.json() as { items?: { volumeInfo: { title?: string; subtitle?: string; authors?: string[]; publisher?: string; publishedDate?: string; infoLink?: string; language?: string; industryIdentifiers?: { type: string; identifier: string }[] } }[] };
    const vols = (body.items ?? []).map((i) => i.volumeInfo).filter((v) => bookMatches(s, v));
    // Prefere a edição em português ("pt" ou "pt-BR"), com editora informada, a mais recente.
    const pt = (x: { language?: string }) => Number(/^pt/i.test(x.language ?? ''));
    const v = vols.sort((a, b) => pt(b) - pt(a) || Number(!!b.publisher) - Number(!!a.publisher) || (b.publishedDate ?? '').localeCompare(a.publishedDate ?? ''))[0];
    if (!v || verified.some((b) => normalizeText(b.title) === normalizeText(v.title ?? ''))) continue;
    verified.push({
      title: [v.title, v.subtitle].filter(Boolean).join(': '), authors: v.authors ?? [], publisher: v.publisher ?? '', year: (v.publishedDate ?? '').slice(0, 4),
      link: v.infoLink ?? '', isbn: v.industryIdentifiers?.find((x) => x.type === 'ISBN_13')?.identifier ?? '', why: s.por_que.trim().slice(0, 160),
    });
  }
  await store(admin, key, BOOKS_PROMPT_VERSION, defaultModel(), { suggested, verified });
  return verified;
}
