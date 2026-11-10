// Jurisprudência de um tema: súmulas e teses oficiais ligadas aos artigos (precedents_for_refs) e a escolha da IA das que
// mais caem, em cache compartilhado (juris_picks). Usada pela aba Jurisprudência e pela apostila de nível superior.
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateJson, GeminiError } from '../../../shared/ai/gemini.ts';
import { JURIS_PROMPT_VERSION, JurisPicks, jurisJsonSchema, jurisPrompt, MAX_JURIS_CANDIDATES, mergePicks, rankCandidates, refsParam, type JurisCandidate, type JurisItem } from '../../../shared/ai/juris.ts';
import { normalizeText } from '../../../shared/ai/notice.ts';
import { sha256Hex } from '../../../shared/ai/notice-cache.ts';
import type { LawRef } from '../../../shared/legal/refs.ts';
import { defaultModel, keyFor } from './ai.ts';
import { logUsage } from './http.ts';

export interface JurisTopic { banca: string; subject: string; title: string; refs: LawRef[] }

// canGenerate: chamada à IA quando a escolha não está em cache (tem custo). Sem ela, ou se a IA falhar, a lista vem
// completa, sem destaques. ai = a escolha da IA está aplicada.
export async function topicJuris(admin: SupabaseClient, ownerId: string, t: JurisTopic, canGenerate: () => Promise<boolean>): Promise<{ items: JurisItem[]; ai: boolean }> {
  if (!t.refs.length) return { items: [], ai: false };
  const { data, error } = await admin.rpc('precedents_for_refs', { p_refs: refsParam(t.refs) });
  if (error) throw new Error(`jurisprudência: ${error.message}`);
  const candidates = (data ?? []) as JurisCandidate[];
  if (!candidates.length) return { items: [], ai: false };
  const items = rankCandidates(candidates).slice(0, MAX_JURIS_CANDIDATES);
  const key = await sha256Hex(JSON.stringify([normalizeText(t.banca), normalizeText(t.subject), normalizeText(t.title), items.map((c) => c.id)]));
  const { data: hit } = await admin.from('juris_picks').select('result').eq('cache_key', key).eq('prompt_version', JURIS_PROMPT_VERSION).maybeSingle();
  if (hit) return { items: mergePicks(candidates, JurisPicks.parse(hit.result)), ai: true };
  if (!await canGenerate()) return { items: mergePicks(candidates, null), ai: false };
  const model = defaultModel(), started = Date.now();
  try {
    const r = await generateJson({ apiKey: keyFor(model), model, schema: JurisPicks, jsonSchema: jurisJsonSchema(), temperature: 0.1, thinkingLevel: 'low', timeoutMs: 45_000,
      parts: [{ text: jurisPrompt({ banca: t.banca, subject: t.subject, title: t.title, items }) }] });
    await admin.from('juris_picks').upsert({ cache_key: key, prompt_version: JURIS_PROMPT_VERSION, model, result: r.data }, { onConflict: 'cache_key,prompt_version' });
    await logUsage(admin, { ownerId, operation: 'juris_picks', model, promptVersion: JURIS_PROMPT_VERSION, usage: r.usage, latencyMs: Date.now() - started, status: 'ok' });
    return { items: mergePicks(candidates, r.data), ai: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logUsage(admin, { ownerId, operation: 'juris_picks', model, promptVersion: JURIS_PROMPT_VERSION, usage: err instanceof GeminiError ? err.usage : null, latencyMs: Date.now() - started, status: 'error', error: message });
    return { items: mergePicks(candidates, null), ai: false };
  }
}
