// Mais cobrados de um tema, segundo a IA, em cache compartilhado (hot_topics). Falha não impede nada: sem a lista, a
// apostila sai sem destaques e a escolha de artigos usa só o título da sessão.
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateJson, GeminiError } from '../../../shared/ai/gemini.ts';
import { HOT_PROMPT_VERSION, HotTopics, hotJsonSchema, hotPrompt, MAX_HOT_ARTICLES, MAX_HOT_THEMES, type HotInput, type HotLaw } from '../../../shared/ai/hot.ts';
import { normalizeText } from '../../../shared/ai/notice.ts';
import { sha256Hex } from '../../../shared/ai/notice-cache.ts';
import { rangesLabel, type LawRef } from '../../../shared/legal/refs.ts';
import { lawByKey, type LawEntry } from '../../../shared/legal/registry.ts';
import { defaultModel, keyFor } from './ai.ts';
import { logUsage } from './http.ts';

// Seções de cada lei da sessão (nome e primeiro e último artigo), a partir dos artigos já carregados: o prompt não leva texto.
export function hotLaws(refs: LawRef[], articles: { lawKey: string; label: string; heading: string }[], extra: LawEntry[]): HotLaw[] {
  return refs.map((r) => {
    const law = lawByKey(r.law, extra), short = law?.short ?? r.law;
    const sections: HotLaw['sections'] = [];
    for (const a of articles.filter((x) => x.lawKey === r.law)) {
      const name = a.heading.split('›').pop()?.trim() || short, last = sections[sections.length - 1];
      if (last && last.name === name) last.to = a.label; else sections.push({ name, from: a.label, to: a.label });
    }
    return { ref: `${short}, arts. ${rangesLabel(r)}`, short, sections: sections.slice(0, 60) };
  });
}

export async function ensureHot(admin: SupabaseClient, ownerId: string, input: HotInput): Promise<HotTopics | null> {
  const key = await sha256Hex(JSON.stringify([normalizeText(input.banca), normalizeText(input.subject), normalizeText(input.title), input.laws.map((l) => l.ref)]));
  const { data: hit } = await admin.from('hot_topics').select('result').eq('cache_key', key).eq('prompt_version', HOT_PROMPT_VERSION).maybeSingle();
  if (hit) return HotTopics.parse(hit.result);
  const model = defaultModel(), started = Date.now();
  try {
    const r = await generateJson({ apiKey: keyFor(model), model, schema: HotTopics, jsonSchema: hotJsonSchema(), temperature: 0.1, thinkingLevel: 'low', timeoutMs: 30_000, parts: [{ text: hotPrompt(input) }] });
    const result: HotTopics = { temas: r.data.temas.map((t) => t.trim().slice(0, 120)).filter(Boolean).slice(0, MAX_HOT_THEMES), artigos: r.data.artigos.map((a) => a.trim().slice(0, 60)).filter(Boolean).slice(0, MAX_HOT_ARTICLES) };
    await admin.from('hot_topics').upsert({ cache_key: key, prompt_version: HOT_PROMPT_VERSION, model, result }, { onConflict: 'cache_key,prompt_version' });
    await logUsage(admin, { ownerId, operation: 'hot_topics', model, promptVersion: HOT_PROMPT_VERSION, usage: r.usage, latencyMs: Date.now() - started, status: 'ok' });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logUsage(admin, { ownerId, operation: 'hot_topics', model, promptVersion: HOT_PROMPT_VERSION, usage: err instanceof GeminiError ? err.usage : null, latencyMs: Date.now() - started, status: 'error', error: message });
    return null;
  }
}
