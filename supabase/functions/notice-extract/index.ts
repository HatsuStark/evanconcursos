// Edge Function "notice-extract": interpretação do edital.
// POST {noticeId, fileId, roleHint?} → 202 {jobId}. O processamento segue em segundo plano:
// baixa o PDF do bucket privado, pede ao Gemini os dados estruturados (validados pelo schema Zod),
// confere contra o texto do PDF, grava a extração (notice_extractions), o consumo (ai_usage) e o job (ai_jobs).
// O app acompanha pelo job; o usuário confere e aprova depois (approve_notice).
import { extractText } from 'unpdf';
import { costUsd, GeminiError, generateJson, toBase64, type GeminiUsage } from '../../../shared/ai/gemini.ts';
import { checkNotice, NOTICE_PROMPT_VERSION, NoticeExtraction, noticeJsonSchema, noticePrompt } from '../../../shared/ai/notice.ts';
import { adminClient, CORS, json, modelPrice, requireUser } from '../_shared/http.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const OPERATION = 'notice_extract';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
  try {
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;
    const body = await req.json().catch(() => ({}));
    const noticeId = String(body.noticeId ?? ''), fileId = String(body.fileId ?? ''), roleHint = String(body.roleHint ?? '').slice(0, 160);

    // Posse conferida com o cliente do usuário: a RLS só devolve arquivos dele.
    const { data: file } = await auth.client.from('notice_files').select('id, notice_id, storage_path')
      .eq('id', fileId).eq('notice_id', noticeId).maybeSingle();
    if (!file) return json(404, { error: 'Arquivo do edital não encontrado.' });

    const admin = adminClient();
    const { data: job, error } = await admin.from('ai_jobs').insert({
      owner_id: auth.user.id, kind: OPERATION, status: 'running', started_at: new Date().toISOString(),
      input: { noticeId, fileId, roleHint }, progress: { step: 'reading' },
    }).select('id').single();
    if (error || !job) return json(500, { error: 'Não foi possível iniciar a leitura.' });

    EdgeRuntime.waitUntil(process({ jobId: job.id, ownerId: auth.user.id, noticeId, fileId, path: file.storage_path, roleHint }));
    return json(202, { jobId: job.id });
  } catch (err) {
    return json(500, { error: 'Erro ao iniciar a leitura do edital.', detail: String(err).slice(0, 300) });
  }
});

async function process(p: { jobId: string; ownerId: string; noticeId: string; fileId: string; path: string; roleHint: string }) {
  const admin = adminClient();
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash';
  const step = (s: string) => admin.from('ai_jobs').update({ progress: { step: s } }).eq('id', p.jobId);
  let usage: GeminiUsage | null = null, latencyMs: number | null = null;
  try {
    const { data: blob, error } = await admin.storage.from('editais').download(p.path);
    if (error || !blob) throw new Error('Não foi possível ler o PDF enviado.');
    const bytes = new Uint8Array(await blob.arrayBuffer());

    // Texto do PDF para conferir os tópicos (se falhar, a extração segue sem essa verificação).
    let pdfText: string | null = null;
    try {
      const t = await extractText(bytes.slice(), { mergePages: true });
      pdfText = t.text;
      await admin.from('notice_files').update({ pages: t.totalPages }).eq('id', p.fileId);
    } catch { /* PDF só com imagem ou protegido */ }

    await step('analyzing');
    const r = await generateJson({
      apiKey: Deno.env.get('GEMINI_API_KEY') ?? '', model, schema: NoticeExtraction, jsonSchema: noticeJsonSchema(),
      parts: [{ inline_data: { mime_type: 'application/pdf', data: toBase64(bytes) } }, { text: noticePrompt(p.roleHint) }],
    });
    usage = r.usage; latencyMs = r.latencyMs;

    await step('checking');
    const warnings = checkNotice(r.data, pdfText);
    if (pdfText === null) warnings.push({ code: 'pdf_text_unavailable', message: 'Não foi possível ler o texto do PDF para conferir os tópicos. Revise com atenção.' });
    const { data: extraction, error: exErr } = await admin.from('notice_extractions').insert({
      owner_id: p.ownerId, notice_id: p.noticeId, file_id: p.fileId, status: 'succeeded', model, prompt_version: NOTICE_PROMPT_VERSION,
      raw: r.raw, result: r.data, warnings, finished_at: new Date().toISOString(),
    }).select('id').single();
    if (exErr || !extraction) throw new Error('Não foi possível salvar a leitura do edital.');

    await logUsage(admin, p, model, usage, latencyMs, 'ok');
    await admin.from('ai_jobs').update({ status: 'succeeded', finished_at: new Date().toISOString(), result: { extractionId: extraction.id }, progress: { step: 'done' } }).eq('id', p.jobId);
  } catch (err) {
    if (err instanceof GeminiError) usage = err.usage;
    const message = err instanceof Error ? err.message : String(err);
    await logUsage(admin, p, model, usage, latencyMs, 'error', message);
    await admin.from('ai_jobs').update({ status: 'failed', finished_at: new Date().toISOString(), error: message.slice(0, 1000) }).eq('id', p.jobId);
  }
}

async function logUsage(admin: ReturnType<typeof adminClient>, p: { jobId: string; ownerId: string }, model: string,
  usage: GeminiUsage | null, latencyMs: number | null, status: 'ok' | 'error', error?: string) {
  const price = usage ? await modelPrice(admin, model) : null;
  await admin.from('ai_usage').insert({
    owner_id: p.ownerId, job_id: p.jobId, operation: OPERATION, model, prompt_version: NOTICE_PROMPT_VERSION,
    input_tokens: usage?.inputTokens ?? 0, output_tokens: usage?.outputTokens ?? 0, thinking_tokens: usage?.thinkingTokens ?? 0,
    cost_usd: usage && price ? costUsd(usage, price) : null, latency_ms: latencyMs, status, error: error?.slice(0, 1000) ?? null,
  });
}
