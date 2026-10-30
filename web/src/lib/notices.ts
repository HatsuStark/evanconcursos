// Editais: envio do PDF, leitura pela IA (job), conferência e aprovação.
import { useQuery } from '@tanstack/react-query';
import { NoticeExtraction, subjectWeights, type NoticeWarning } from '../../../shared/ai/notice.ts';
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
  notice: NoticeRow & { notes: string[]; structure: Partial<Draft['structure']> };
  extraction: { id: string; model: string; prompt_version: string; warnings: NoticeWarning[]; created_at: string } | null;
  usage: { cost_usd: number | null; latency_ms: number | null } | null;
  draft: Draft;
}

// Dados para a conferência: se já conferido, vem das tabelas; senão, da última leitura da IA.
export const useReview = (noticeId: string | undefined) => useQuery({
  queryKey: ['review', noticeId],
  enabled: !!noticeId,
  queryFn: async (): Promise<ReviewData> => {
    const notice = must(await supabase.from('notices').select('id, title, organization, role_name, board, exam_date, status, total_questions, created_at, notes, structure').eq('id', noticeId!).single()) as ReviewData['notice'];
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
    return { notice, extraction, usage, draft };
  },
});

export async function approveNotice(noticeId: string, extractionId: string | null, draft: Draft) {
  const subjects = draft.subjects.filter((s) => s.name.trim());
  if (!subjects.length) throw new Error('Mantenha ao menos uma disciplina.');
  const { error } = await supabase.rpc('approve_notice', { p_notice_id: noticeId, p_extraction_id: extractionId, p_data: { ...draft, subjects } });
  if (error) throw new Error(error.message);
}
