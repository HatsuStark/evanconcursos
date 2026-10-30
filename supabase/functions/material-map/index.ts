// Edge Function "material-map": mapeia as páginas de uma apostila do estudante para as sessões do cronograma.
// POST {materialId} → 202; o processamento segue em segundo plano e atualiza materials.status
// (mapping → mapped | failed) e material_maps. Ler o PDF e chamar a IA leva de 20 s a 2 min.
import { extractText } from 'unpdf';
import { generateJson, GeminiError, type GeminiUsage } from '../../../shared/ai/gemini.ts';
import { hasText, MATERIAL_PROMPT_VERSION, MaterialMap, materialJsonSchema, materialPrompt, pageIndex, validateMap } from '../../../shared/ai/material.ts';
import { adminClient, CORS, json, logUsage, requireUser } from '../_shared/http.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const body = await req.json().catch(() => ({}));
  const { data: material } = await auth.client.from('materials').select('id, plan_id, storage_path, status').eq('id', String(body.materialId ?? '')).maybeSingle();
  if (!material) return json(404, { error: 'Material não encontrado.' });
  if (material.status === 'mapping') return json(409, { error: 'Este material já está sendo mapeado.' });
  // Sessões da versão ativa do plano (lidas como o usuário).
  const { data: plan } = await auth.client.from('study_plans').select('active_version_id').eq('id', material.plan_id).single();
  const { data: sessions } = await auth.client.from('study_sessions').select('id, title, notice_subjects(name)').eq('plan_version_id', plan?.active_version_id ?? '').order('subject_id').order('position');
  if (!sessions?.length) return json(400, { error: 'O plano ainda não tem sessões.' });

  const admin = adminClient();
  await admin.from('materials').update({ status: 'mapping', status_detail: '' }).eq('id', material.id);
  EdgeRuntime.waitUntil(run(admin, auth.user.id, material, sessions as unknown as { id: string; title: string; notice_subjects: { name: string } | null }[]));
  return json(202, { ok: true });
});

async function run(admin: ReturnType<typeof adminClient>, ownerId: string, material: { id: string; storage_path: string },
  sessions: { id: string; title: string; notice_subjects: { name: string } | null }[]) {
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash', started = Date.now();
  let usage: GeminiUsage | null = null;
  try {
    const { data: blob, error } = await admin.storage.from('materiais').download(material.storage_path);
    if (error || !blob) throw new Error('Não foi possível ler o PDF enviado.');
    const { totalPages, text } = await extractText(new Uint8Array(await blob.arrayBuffer()), { mergePages: false });
    const pages = text as string[];
    await admin.from('materials').update({ pages: totalPages }).eq('id', material.id);
    if (!hasText(pages)) throw new Error('O PDF parece escaneado (só imagem): não há texto para mapear.');
    const coded = sessions.map((s, i) => ({ code: `S${i + 1}`, id: s.id, subject: s.notice_subjects?.name ?? '', title: s.title }));
    const r = await generateJson({ apiKey: Deno.env.get('GEMINI_API_KEY') ?? '', model, schema: MaterialMap, jsonSchema: materialJsonSchema(), temperature: 0.1,
      parts: [{ text: materialPrompt(coded, pageIndex(pages), totalPages) }] });
    usage = r.usage;
    const valid = validateMap(r.data, new Set(coded.map((c) => c.code)), totalPages);
    await admin.from('material_maps').delete().eq('material_id', material.id);
    if (valid.length) {
      const { error: insErr } = await admin.from('material_maps').insert(valid.map((v) => ({
        owner_id: ownerId, material_id: material.id, session_id: coded.find((c) => c.code === v.code)!.id, page_from: v.from, page_to: v.to,
      })));
      if (insErr) throw new Error(insErr.message);
    }
    await admin.from('materials').update({ status: 'mapped', status_detail: `${valid.length} de ${coded.length} sessões encontradas na apostila` }).eq('id', material.id);
    await logUsage(admin, { ownerId, operation: 'material_map', model, promptVersion: MATERIAL_PROMPT_VERSION, usage, latencyMs: Date.now() - started, status: 'ok' });
  } catch (err) {
    if (err instanceof GeminiError) usage = err.usage;
    const message = err instanceof Error ? err.message : String(err);
    await admin.from('materials').update({ status: 'failed', status_detail: message.slice(0, 300) }).eq('id', material.id);
    await logUsage(admin, { ownerId, operation: 'material_map', model, promptVersion: MATERIAL_PROMPT_VERSION, usage, latencyMs: Date.now() - started, status: 'error', error: message });
  }
}
