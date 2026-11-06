// Edge Function "notice-extract": interpretação do edital.
// POST {noticeId, fileId, action: 'roles'} → 200 {roles}: lista os cargos do edital para o candidato escolher.
// POST {noticeId, fileId, roleHint?, roleCode?, otherRoles?} → 202 {jobId}. O processamento segue em segundo plano:
// baixa o PDF do bucket privado, pede ao Gemini os dados estruturados (validados pelo schema Zod),
// confere contra o texto do PDF, grava a extração (notice_extractions), o consumo (ai_usage) e o job (ai_jobs).
// O app acompanha pelo job; o usuário confere e aprova depois (approve_notice).
import { extractText } from 'unpdf';
import { GeminiError, generateJson, toBase64, type GeminiUsage } from '../../../shared/ai/gemini.ts';
import { checkNotice, NOTICE_PROMPT_VERSION, NoticeExtraction, type NoticeRole, NoticeRoles, noticeRolesJsonSchema, normalizeText, readNotice, ROLES_PROMPT_VERSION, rolesPrompt, uniqueRoles } from '../../../shared/ai/notice.ts';
import { noticeRoleKey, worthSharing } from '../../../shared/ai/notice-cache.ts';
import { hasLineText, readNoticeByLines } from '../../../shared/ai/notice-lines.ts';
import { adminClient, CORS, json, logUsage, requireUser } from '../_shared/http.ts';
import { findRead, identifyNotice, registerNotice, saveRead } from '../_shared/notice-cache.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const OPERATION = 'notice_extract';
const ROLES_OPERATION = 'notice_roles';
const modelName = () => Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash';
type Exact = { code: string; otherRoles: string[] } | null;
// Leitura reaproveitada de outro candidato (notice_ai_cache): entra no consumo sem custo de IA.
const CACHE_MODEL = 'cache';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
  try {
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;
    const body = await req.json().catch(() => ({}));
    const noticeId = String(body.noticeId ?? ''), fileId = String(body.fileId ?? ''), roleHint = String(body.roleHint ?? '').slice(0, 160);
    // Cargo escolhido na lista do edital: nome literal, código e os demais cargos.
    const exact: Exact = body.exact ? {
      code: String(body.roleCode ?? '').slice(0, 20),
      otherRoles: (Array.isArray(body.otherRoles) ? body.otherRoles : []).map((r: unknown) => String(r).slice(0, 160)).slice(0, 300),
    } : null;

    // Posse conferida com o cliente do usuário: a RLS só devolve arquivos dele.
    const { data: file } = await auth.client.from('notice_files').select('id, notice_id, storage_path')
      .eq('id', fileId).eq('notice_id', noticeId).maybeSingle();
    // O caminho é gravado pelo app: só vale o que está na pasta do próprio estudante (a função lê com a chave de serviço).
    if (!file || !file.storage_path.startsWith(`${auth.user.id}/`) || file.storage_path.includes('..')) return json(404, { error: 'Arquivo do edital não encontrado.' });
    if (body.action === 'roles') return await listRoles(auth.user.id, file.storage_path);

    const admin = adminClient();
    const { data: job, error } = await admin.from('ai_jobs').insert({
      owner_id: auth.user.id, kind: OPERATION, status: 'running', started_at: new Date().toISOString(),
      input: { noticeId, fileId, roleHint, exact }, progress: { step: 'reading' },
    }).select('id').single();
    if (error || !job) return json(500, { error: 'Não foi possível iniciar a leitura.' });

    EdgeRuntime.waitUntil(process({ jobId: job.id, ownerId: auth.user.id, noticeId, fileId, path: file.storage_path, roleHint, exact }));
    return json(202, { jobId: job.id });
  } catch (err) {
    return json(500, { error: 'Erro ao iniciar a leitura do edital.', detail: String(err).slice(0, 300) });
  }
});

// Lista curta, síncrona: o texto do PDF basta e sai mais barato; PDF só com imagem vai inteiro.
async function listRoles(ownerId: string, path: string) {
  const admin = adminClient(), m = modelName();
  const { data: blob, error } = await admin.storage.from('editais').download(path);
  if (error || !blob) return json(500, { error: 'Não foi possível ler o PDF enviado.' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  try { text = (await extractText(bytes.slice(), { mergePages: true })).text; } catch { /* PDF só com imagem */ }
  // Mesmo edital já listado por outro candidato (mesmo arquivo, mesmo texto ou mesmo título com o texto igual): sem IA.
  const notice = await identifyNotice(bytes, text), keys = notice.keys;
  const found = await findRead(admin, 'roles', notice, '', ROLES_PROMPT_VERSION);
  const hit = found?.read ?? null;
  if (hit) {
    await saveRead(admin, 'roles', keys, '', ROLES_PROMPT_VERSION, hit);
    await logUsage(admin, { ownerId, operation: ROLES_OPERATION, model: CACHE_MODEL, promptVersion: ROLES_PROMPT_VERSION, usage: null, latencyMs: null, status: 'ok' });
    return json(200, { roles: (hit.result as { roles: NoticeRole[] }).roles, cached: true });
  }
  const doc = text.trim().length > 2000 ? { text: `EDITAL:\n${text}` } : { inline_data: { mime_type: 'application/pdf', data: toBase64(bytes) } };
  try {
    const r = await generateJson({ apiKey: Deno.env.get('GEMINI_API_KEY') ?? '', model: m, schema: NoticeRoles, jsonSchema: noticeRolesJsonSchema(), temperature: 0, timeoutMs: 60_000, thinkingLevel: 'low', parts: [doc, { text: rolesPrompt() }] });
    await logUsage(admin, { ownerId, operation: ROLES_OPERATION, model: m, promptVersion: ROLES_PROMPT_VERSION, usage: r.usage, latencyMs: r.latencyMs, status: 'ok' });
    const roles = uniqueRoles(r.data.roles);
    if (roles.length) await saveRead(admin, 'roles', keys, '', ROLES_PROMPT_VERSION, { result: { roles }, raw: null, model: m });
    return json(200, { roles });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logUsage(admin, { ownerId, operation: ROLES_OPERATION, model: m, promptVersion: ROLES_PROMPT_VERSION, usage: err instanceof GeminiError ? err.usage : null, latencyMs: null, status: 'error', error: message });
    return json(502, { error: 'Não foi possível listar os cargos do edital. Digite o cargo.' });
  }
}

async function process(p: { jobId: string; ownerId: string; noticeId: string; fileId: string; path: string; roleHint: string; exact: Exact }) {
  const admin = adminClient();
  const model = modelName();
  const step = (s: string) => admin.from('ai_jobs').update({ progress: { step: s } }).eq('id', p.jobId);
  let usage: GeminiUsage | null = null, latencyMs: number | null = null;
  try {
    const { data: blob, error } = await admin.storage.from('editais').download(p.path);
    if (error || !blob) throw new Error('Não foi possível ler o PDF enviado.');
    const bytes = new Uint8Array(await blob.arrayBuffer());

    // Texto do PDF por página: base da leitura por linhas e da conferência dos tópicos (se falhar, a leitura vai pelo PDF).
    let pdfText: string | null = null, pages: string[] = [];
    try {
      const t = await extractText(bytes.slice(), { mergePages: false });
      pages = t.text;
      pdfText = pages.join('\n');
      await admin.from('notice_files').update({ pages: t.totalPages }).eq('id', p.fileId);
    } catch { /* PDF só com imagem ou protegido */ }

    await step('analyzing');
    // Mesmo edital já lido para o mesmo cargo por outro candidato: reaproveita a leitura da IA (cada um confere a sua).
    const notice = await identifyNotice(bytes, pdfText), keys = notice.keys, roleKey = noticeRoleKey(p.roleHint, p.exact);
    const match = await findRead(admin, 'extract', notice, roleKey, NOTICE_PROMPT_VERSION);
    const found = match?.read ?? null;
    // Edital conhecido e concurso do candidato ligado a ele: o que vem depois da leitura também é reaproveitado.
    await registerNotice(admin, notice);
    await admin.from('notices').update({ doc_key: notice.pdfKey }).eq('id', p.noticeId);
    const parsed = found ? NoticeExtraction.safeParse(found.result) : null;
    const hit = parsed?.success ? found : null;
    let r: { data: NoticeExtraction; raw: unknown };
    let readModel = model;
    if (hit && parsed?.success) {
      r = { data: parsed.data, raw: hit.raw };
      readModel = hit.model || model;
      await saveRead(admin, 'extract', keys, roleKey, NOTICE_PROMPT_VERSION, hit);
    } else {
      // Com texto, leitura por linhas (a IA aponta, o código copia); PDF só com imagem, a leitura pelo PDF.
      const args = { apiKey: Deno.env.get('GEMINI_API_KEY') ?? '', model, pdfBase64: toBase64(bytes), roleHint: p.roleHint, exact: p.exact ?? undefined };
      const read = hasLineText(pages) ? await readNoticeByLines({ ...args, pages }) : await readNotice(args);
      usage = read.usage; latencyMs = read.latencyMs;
      r = { data: read.data, raw: read.raw };
      if (worthSharing(read.data)) await saveRead(admin, 'extract', keys, roleKey, NOTICE_PROMPT_VERSION, { result: read.data, raw: read.raw, model });
    }
    // Cargo escolhido na lista: nome e demais cargos vêm da escolha, não da leitura.
    if (p.exact && p.roleHint) {
      r.data.role = p.roleHint;
      if (p.exact.otherRoles.length) r.data.otherRoles = p.exact.otherRoles.filter((o) => normalizeText(o) !== normalizeText(p.roleHint));
    }

    await step('checking');
    // Disciplinas com tópicos resumidos pela IA (a cópia literal foi recusada): um aviso próprio no lugar do "não
    // encontrados no PDF", que é esperado nelas.
    const summarized = new Set(((r.raw as { summarized?: string[] } | null)?.summarized ?? []).map(String));
    const warnings = checkNotice(r.data, pdfText).filter((w) => !(w.code === 'topic_not_found' && w.subject && summarized.has(w.subject)));
    for (const name of summarized) warnings.push({ code: 'topics_summarized', subject: name, message: `${name}: a IA não conseguiu copiar o texto do edital e listou os tópicos resumidos. Confira com o conteúdo programático do PDF.` });
    if (pdfText === null) warnings.push({ code: 'pdf_text_unavailable', message: 'Não foi possível ler o texto do PDF para conferir os tópicos. Revise com atenção.' });
    // Leitura de outro arquivo com o mesmo título e o texto quase igual: uma retificação pequena também passa por aqui.
    if (hit && match?.fuzzy) warnings.push({ code: 'reused_similar_notice', message: 'Aproveitamos a leitura de uma cópia deste edital. Confira as datas e as vagas com o seu PDF.' });
    const { data: extraction, error: exErr } = await admin.from('notice_extractions').insert({
      owner_id: p.ownerId, notice_id: p.noticeId, file_id: p.fileId, status: 'succeeded', model: readModel, prompt_version: NOTICE_PROMPT_VERSION,
      raw: r.raw, result: r.data, warnings, finished_at: new Date().toISOString(),
    }).select('id').single();
    if (exErr || !extraction) throw new Error('Não foi possível salvar a leitura do edital.');

    await logUsage(admin, { ownerId: p.ownerId, jobId: p.jobId, operation: OPERATION, model: hit ? CACHE_MODEL : model, promptVersion: NOTICE_PROMPT_VERSION, usage, latencyMs, status: 'ok' });
    await admin.from('ai_jobs').update({ status: 'succeeded', finished_at: new Date().toISOString(), result: { extractionId: extraction.id }, progress: { step: 'done' } }).eq('id', p.jobId);
  } catch (err) {
    const cause = err instanceof Error ? err.cause : null;
    if (err instanceof GeminiError) usage = err.usage;
    else if (cause instanceof GeminiError) usage = cause.usage;
    const message = err instanceof Error ? err.message : String(err);
    await logUsage(admin, { ownerId: p.ownerId, jobId: p.jobId, operation: OPERATION, model, promptVersion: NOTICE_PROMPT_VERSION, usage, latencyMs, status: 'error', error: message });
    await admin.from('ai_jobs').update({ status: 'failed', finished_at: new Date().toISOString(), error: message.slice(0, 1000) }).eq('id', p.jobId);
  }
}

