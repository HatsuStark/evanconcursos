// Editais: envio do PDF, leitura pela IA (job), conferência e aprovação.
import { useQuery } from '@tanstack/react-query';
import { NoticeExtraction, subjectWeights, type NoticeWarning } from '../../../shared/ai/notice.ts';
import { diffNotices, studiedTopics, subjectEquivalence, type DiffNotice } from '../../../shared/domain/notice-diff.ts';
import { noticeLawKeys } from '../../../shared/legal/refs.ts';
import { lawByKey } from '../../../shared/legal/registry.ts';
import { supabase } from './supabase.ts';

export interface NoticeRow {
  id: string; title: string; organization: string; role_name: string; board: string; exam_date: string | null;
  status: 'draft' | 'reviewed' | 'archived'; total_questions: number; created_at: string;
}
export interface JobRow { id: string; status: 'pending' | 'running' | 'succeeded' | 'failed'; progress: { step?: string } | null; error: string | null; result: { extractionId?: string } | null; created_at: string; finished_at: string | null }

// Rascunho editável da conferência (o que vai para approve_notice).
export interface DraftTopic { text: string; page: number }
export interface DraftSubject { name: string; block: string; questions: number; core: boolean; weight: number; topics: DraftTopic[] }
export interface Draft {
  title: string; organization: string; role: string; board: string; examDate: string; totalQuestions: number;
  notes: string[]; structure: { blocks: NoticeExtraction['blocks']; stages: NoticeExtraction['stages']; otherRoles: string[] };
  subjects: DraftSubject[];
}

const must = <T,>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

export const useNotices = () => useQuery({
  queryKey: ['notices'],
  queryFn: async () => must(await supabase.from('notices').select('id, title, organization, role_name, board, exam_date, status, total_questions, created_at')
    .neq('status', 'archived').order('created_at', { ascending: false })) as NoticeRow[],
});

// Resumo por edital conferido: matérias, tópicos e questões (para os cards).
export const useNoticeStats = (ids: string[]) => useQuery({
  queryKey: ['notice-stats', ids],
  enabled: ids.length > 0,
  queryFn: async () => {
    const subjects = must(await supabase.from('notice_subjects').select('id, notice_id, name, weight, questions').in('notice_id', ids)) as { id: string; notice_id: string; name: string; weight: number; questions: number }[];
    const topics = subjects.length ? must(await supabase.from('notice_topics').select('subject_id').in('subject_id', subjects.map((s) => s.id))) as { subject_id: string }[] : [];
    return Object.fromEntries(ids.map((id) => {
      const subs = subjects.filter((s) => s.notice_id === id), sids = new Set(subs.map((s) => s.id));
      return [id, { subjects: subs, topics: topics.filter((t) => sids.has(t.subject_id)).length }];
    }));
  },
});

async function sha256Hex(bytes: ArrayBuffer) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const MAX_PDF_BYTES = 20 * 1024 * 1024;

// Cria o edital, envia o PDF ao bucket privado e dispara a leitura. Devolve o edital e o job.
export async function uploadNotice(file: File, roleHint: string): Promise<{ noticeId: string; jobId: string }> {
  if (file.type && file.type !== 'application/pdf') throw new Error('O arquivo precisa ser um PDF.');
  if (file.size > MAX_PDF_BYTES) throw new Error('O PDF passa de 20 MB.');
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) throw new Error('Entre na sua conta para enviar o edital.');
  const bytes = await file.arrayBuffer(), sha = await sha256Hex(bytes);
  const notice = must(await supabase.from('notices').insert({ title: file.name.replace(/\.pdf$/i, '').slice(0, 160) }).select('id').single()) as { id: string };
  const path = `${uid}/${notice.id}/${sha}.pdf`;
  const up = await supabase.storage.from('editais').upload(path, bytes, { contentType: 'application/pdf', upsert: false });
  if (up.error) throw new Error(`Falha no envio do PDF: ${up.error.message}`);
  const row = must(await supabase.from('notice_files').insert({ notice_id: notice.id, storage_path: path, sha256: sha, size_bytes: file.size }).select('id').single()) as { id: string };
  const { data, error } = await supabase.functions.invoke('notice-extract', { body: { noticeId: notice.id, fileId: row.id, roleHint } });
  if (error) {
    let msg = error.message;
    try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* resposta sem JSON */ }
    throw new Error(msg);
  }
  return { noticeId: notice.id, jobId: (data as { jobId: string }).jobId };
}

// Acompanha o job até terminar (a leitura leva de 30 s a 2 min).
export const useJob = (jobId: string | undefined) => useQuery({
  queryKey: ['job', jobId],
  enabled: !!jobId,
  queryFn: async () => must(await supabase.from('ai_jobs').select('id, status, progress, error, result, created_at, finished_at').eq('id', jobId!).single()) as JobRow,
  refetchInterval: (q) => (q.state.data && ['succeeded', 'failed'].includes(q.state.data.status) ? false : 2000),
});

export interface ReviewData {
  notice: NoticeRow & { notes: string[]; structure: Partial<Draft['structure']>; replaces_notice_id: string | null };
  extraction: { id: string; model: string; prompt_version: string; warnings: NoticeWarning[]; created_at: string } | null;
  usage: { cost_usd: number | null; latency_ms: number | null } | null;
  draft: Draft;
  hasPlan: boolean;
}

// Dados para a conferência: se já conferido, vem das tabelas; senão, da última leitura da IA.
export const useReview = (noticeId: string | undefined) => useQuery({
  queryKey: ['review', noticeId],
  enabled: !!noticeId,
  queryFn: async (): Promise<ReviewData> => {
    const notice = must(await supabase.from('notices').select('id, title, organization, role_name, board, exam_date, status, total_questions, created_at, notes, structure, replaces_notice_id').eq('id', noticeId!).single()) as ReviewData['notice'];
    const ex = must(await supabase.from('notice_extractions').select('id, model, prompt_version, warnings, result, created_at')
      .eq('notice_id', noticeId!).eq('status', 'succeeded').order('created_at', { ascending: false }).limit(1)) as (ReviewData['extraction'] & { result: unknown })[];
    const extraction = ex[0] ?? null;
    let usage: ReviewData['usage'] = null;
    if (extraction) {
      const jobs = must(await supabase.from('ai_jobs').select('id').eq('kind', 'notice_extract').contains('result', { extractionId: extraction.id }).limit(1)) as { id: string }[];
      if (jobs[0]) usage = (must(await supabase.from('ai_usage').select('cost_usd, latency_ms').eq('job_id', jobs[0].id).limit(1)) as ReviewData['usage'][])[0] ?? null;
    }
    let draft: Draft;
    if (notice.status === 'reviewed') {
      const subs = must(await supabase.from('notice_subjects').select('id, name, block, questions, is_core, weight, position').eq('notice_id', notice.id).order('position')) as { id: string; name: string; block: string; questions: number; is_core: boolean; weight: number }[];
      const tops = subs.length ? must(await supabase.from('notice_topics').select('subject_id, text, source_page, position').in('subject_id', subs.map((s) => s.id)).order('position')) as { subject_id: string; text: string; source_page: number | null }[] : [];
      draft = {
        title: notice.title, organization: notice.organization, role: notice.role_name, board: notice.board, examDate: notice.exam_date ?? '',
        totalQuestions: notice.total_questions, notes: notice.notes ?? [],
        structure: { blocks: notice.structure.blocks ?? [], stages: notice.structure.stages ?? [], otherRoles: notice.structure.otherRoles ?? [] },
        subjects: subs.map((s) => ({ name: s.name, block: s.block, questions: s.questions, core: s.is_core, weight: s.weight,
          topics: tops.filter((t) => t.subject_id === s.id).map((t) => ({ text: t.text, page: t.source_page ?? 0 })) })),
      };
    } else if (extraction) {
      const e = NoticeExtraction.parse(extraction.result), weights = subjectWeights(e);
      draft = {
        title: [e.role, e.organization].filter(Boolean).join(' · ') || notice.title,
        organization: e.organization, role: e.role, board: e.board, examDate: e.examDate, totalQuestions: e.totalQuestions, notes: e.notes,
        structure: { blocks: e.blocks, stages: e.stages, otherRoles: e.otherRoles },
        subjects: e.subjects.map((s, i) => ({ name: s.name, block: s.block, questions: s.questions, core: s.core, weight: weights[i] ?? 2, topics: s.topics })),
      };
    } else throw new Error('Este edital ainda não foi lido pela IA.');
    const plans = must(await supabase.from('study_plans').select('id').eq('notice_id', notice.id).limit(1)) as { id: string }[];
    return { notice, extraction, usage, draft, hasPlan: plans.length > 0 };
  },
});

// Apaga todos os arquivos de uma pasta do bucket (as pastas são por edital e por plano).
async function clearFolder(bucket: string, folder: string) {
  const { data, error } = await supabase.storage.from(bucket).list(folder, { limit: 1000 });
  if (error) throw new Error(error.message);
  if (!data?.length) return;
  const removed = await supabase.storage.from(bucket).remove(data.map((f) => `${folder}/${f.name}`));
  if (removed.error) throw new Error(`Falha ao apagar os PDFs: ${removed.error.message}`);
}

// Leis citadas só por este concurso: as marcações delas saem junto; as de leis de outro concurso ficam.
async function lawUrnsOnlyIn(noticeId: string) {
  const subs = must(await supabase.from('notice_subjects').select('notice_id, name, notice_topics(text)')) as { notice_id: string; name: string; notice_topics: { text: string }[] }[];
  const keys = (mine: boolean) => noticeLawKeys(subs.filter((s) => (s.notice_id === noticeId) === mine).map((s) => ({ name: s.name, topics: s.notice_topics.map((t) => t.text) })));
  const others = keys(false);
  return [...keys(true)].filter((k) => !others.has(k)).map((k) => lawByKey(k)!.urn);
}

// Exclusão definitiva. Os PDFs saem antes do banco: se algo falhar no meio, o concurso continua na lista e
// basta excluir de novo; na ordem inversa, os arquivos ficariam no bucket sem nada que apontasse para eles.
// Os editais antigos que este substituiu estão arquivados, fora da lista, com o histórico do mesmo concurso: saem juntos,
// do mais novo para o mais antigo, ou ficariam para sempre sem como apagar.
export async function deleteNotice(noticeId: string) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error('Entre na sua conta.');
  for (let id: string | null = noticeId; id;) {
    const { replaces_notice_id: previous } = must(await supabase.from('notices').select('replaces_notice_id').eq('id', id).single()) as { replaces_notice_id: string | null };
    const plans = must(await supabase.from('study_plans').select('id').eq('notice_id', id)) as { id: string }[];
    const urns = await lawUrnsOnlyIn(id);
    await clearFolder('editais', `${u.user.id}/${id}`);
    for (const p of plans) await clearFolder('materiais', `${u.user.id}/${p.id}`);
    const { error } = await supabase.rpc('delete_notice', { p_notice: id, p_law_urns: urns });
    if (error) throw new Error(error.message);
    id = previous;
  }
}

// Edital novo enviado para atualizar um plano: liga ao edital antigo, para a comparação valer em qualquer aparelho.
export async function rememberUpdate(noticeId: string, previousId: string) {
  must(await supabase.from('notices').update({ replaces_notice_id: previousId }).eq('id', noticeId));
}

async function diffSide(noticeId: string) {
  const n = must(await supabase.from('notices').select('title, organization, role_name, board, exam_date').eq('id', noticeId).single()) as { title: string; organization: string; role_name: string; board: string; exam_date: string | null };
  const subs = must(await supabase.from('notice_subjects').select('id, name, notice_topics(id, text, position)').eq('notice_id', noticeId).order('position')) as { id: string; name: string; notice_topics: { id: string; text: string; position: number }[] }[];
  const side: DiffNotice & { title: string } = {
    title: n.title, organization: n.organization, role: n.role_name, board: n.board, examDate: n.exam_date ?? '',
    subjects: subs.map((s) => ({ name: s.name, topics: [...s.notice_topics].sort((a, b) => a.position - b.position).map((t) => ({ id: t.id, text: t.text })) })),
  };
  return { side, subjects: subs.map((s) => ({ id: s.id, name: s.name })) };
}

// Só lê: compara o edital com o que ele substitui e cruza com o que já foi concluído no plano antigo. null se não substitui nenhum.
export async function loadNoticeUpdate(noticeId: string) {
  const { replaces_notice_id: previousId } = must(await supabase.from('notices').select('replaces_notice_id').eq('id', noticeId).single()) as { replaces_notice_id: string | null };
  if (!previousId) return null;
  const [next, previous] = await Promise.all([diffSide(noticeId), diffSide(previousId)]);
  const plan = (must(await supabase.from('study_plans').select('id').eq('notice_id', previousId).eq('status', 'active').limit(1)) as { id: string }[])[0];
  const tasks = plan ? must(await supabase.from('tasks').select('session_id, done_at').eq('plan_id', plan.id).eq('kind', 'theory').is('superseded_in_version', null).not('session_id', 'is', null).limit(5000)) as { session_id: string; done_at: string | null }[] : [];
  const ids = [...new Set(tasks.map((t) => t.session_id))];
  const sessions = ids.length ? must(await supabase.from('study_sessions').select('id, topic_ids').in('id', ids)) as { id: string; topic_ids: string[] }[] : [];
  const studied = studiedTopics(sessions.map((s) => ({ topicIds: s.topic_ids, done: tasks.filter((t) => t.session_id === s.id).every((t) => t.done_at) })));
  const diff = diffNotices(previous.side, next.side, studied);
  return {
    previousId, previous: previous.side, next: next.side, diff, alreadyUpdated: !plan,
    subjects: subjectEquivalence(previous.subjects, next.subjects),
    studiedTopics: new Set(diff.topics.filter((t) => t.studied).map((t) => t.id)),
  };
}
export const useNoticeDiff = (noticeId: string | undefined) => useQuery({
  queryKey: ['notice-diff', noticeId],
  enabled: !!noticeId,
  queryFn: () => loadNoticeUpdate(noticeId!),
});

export async function approveNotice(noticeId: string, extractionId: string | null, draft: Draft) {
  const subjects = draft.subjects.filter((s) => s.name.trim());
  if (!subjects.length) throw new Error('Mantenha ao menos uma disciplina.');
  const { error } = await supabase.rpc('approve_notice', { p_notice_id: noticeId, p_extraction_id: extractionId, p_data: { ...draft, subjects } });
  if (error) throw new Error(error.message);
}
