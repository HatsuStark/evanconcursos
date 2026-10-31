// Biblioteca pessoal: PDFs do estudante (bucket privado), mapeamento de páginas pela IA e links temporários.
import { useQuery } from '@tanstack/react-query';
import type { MarkRect } from '../../../shared/domain/pdf-reading.ts';
import { supabase } from './supabase.ts';

export interface Material { id: string; title: string; storage_path: string; pages: number | null; status: 'uploaded' | 'mapping' | 'mapped' | 'failed'; status_detail: string; size_bytes: number; created_at: string }
export interface SessionPages { id: string; page_from: number; page_to: number; manual: boolean; material: { id: string; title: string; storage_path: string; pages: number | null } }
export interface MaterialPages { id: string; page_from: number; page_to: number; manual: boolean; session: { title: string; subject: { name: string } | null } | null }
export type NoteColor = 'yellow' | 'green' | 'pink';
export interface MaterialNote { id: string; page: number; rects: MarkRect[]; quote: string; note: string; color: NoteColor }
export const MAX_MATERIAL_BYTES = 50 * 1024 * 1024;

export const useMaterials = (planId: string | undefined) => useQuery({
  queryKey: ['materials', planId],
  enabled: !!planId,
  queryFn: async () => {
    const { data, error } = await supabase.from('materials').select('id, title, storage_path, pages, status, status_detail, size_bytes, created_at').eq('plan_id', planId!).order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data as Material[];
  },
  // Enquanto algum material está sendo mapeado, atualiza a cada 4 s.
  refetchInterval: (q) => (q.state.data?.some((m) => m.status === 'mapping') ? 4000 : false),
});

export const useSessionPages = (sessionId: string | null) => useQuery({
  queryKey: ['session-pages', sessionId],
  enabled: !!sessionId,
  queryFn: async () => {
    const { data, error } = await supabase.from('material_maps').select('id, page_from, page_to, manual, material:materials(id, title, storage_path, pages)').eq('session_id', sessionId!).order('page_from');
    if (error) throw new Error(error.message);
    return data as unknown as SessionPages[];
  },
});

// Todos os trechos de uma apostila, em ordem de página, para conferir o mapeamento de uma vez.
export const useMaterialPages = (materialId: string | null) => useQuery({
  queryKey: ['material-pages', materialId],
  enabled: !!materialId,
  queryFn: async () => {
    const { data, error } = await supabase.from('material_maps').select('id, page_from, page_to, manual, session:study_sessions(title, subject:notice_subjects(name))').eq('material_id', materialId!).order('page_from');
    if (error) throw new Error(error.message);
    return data as unknown as MaterialPages[];
  },
});

// O estudante corrige, acrescenta e apaga trechos. O que ele corrigiu ou acrescentou fica ao mapear de novo.
export async function updateSessionPages(id: string, from: number, to: number) {
  const { error } = await supabase.from('material_maps').update({ page_from: from, page_to: to }).eq('id', id);
  if (error) throw new Error(error.message);
}
export async function addSessionPages(materialId: string, sessionId: string, from: number, to: number) {
  const { error } = await supabase.from('material_maps').insert({ material_id: materialId, session_id: sessionId, page_from: from, page_to: to, manual: true });
  if (error) throw new Error(error.message);
}
export async function deleteSessionPages(id: string) {
  const { error } = await supabase.from('material_maps').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export const useMaterialNotes = (materialId: string) => useQuery({
  queryKey: ['material-notes', materialId],
  queryFn: async () => {
    const { data, error } = await supabase.from('material_notes').select('id, page, rects, quote, note, color').eq('material_id', materialId).order('page').order('created_at');
    if (error) throw new Error(error.message);
    return data as MaterialNote[];
  },
});
export async function addMaterialNotes(materialId: string, parts: { page: number; rects: MarkRect[]; quote: string }[], color: NoteColor) {
  const { data, error } = await supabase.from('material_notes').insert(parts.map((p) => ({ material_id: materialId, page: p.page, rects: p.rects, quote: p.quote.slice(0, 4000), color }))).select('id');
  if (error) throw new Error(error.message);
  return (data as { id: string }[])[0]!.id;
}
export async function updateMaterialNote(id: string, patch: Partial<Pick<MaterialNote, 'note' | 'color'>>) {
  const { error } = await supabase.from('material_notes').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}
export async function deleteMaterialNote(id: string) {
  const { error } = await supabase.from('material_notes').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

async function invoke(name: string, body: Record<string, unknown>) {
  const { error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* sem JSON */ }
    throw new Error(msg);
  }
}

export async function uploadMaterial(file: File, planId: string) {
  if (file.type && file.type !== 'application/pdf') throw new Error('O arquivo precisa ser um PDF.');
  if (file.size > MAX_MATERIAL_BYTES) throw new Error('O PDF passa de 50 MB.');
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error('Entre na sua conta.');
  const bytes = await file.arrayBuffer();
  const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const path = `${u.user.id}/${planId}/${sha}.pdf`;
  const up = await supabase.storage.from('materiais').upload(path, bytes, { contentType: 'application/pdf', upsert: false });
  if (up.error && !/exists|duplicate/i.test(up.error.message)) throw new Error(`Falha no envio: ${up.error.message}`);
  const { data, error } = await supabase.from('materials').insert({ plan_id: planId, title: file.name.replace(/\.pdf$/i, '').slice(0, 200), storage_path: path, sha256: sha, size_bytes: file.size }).select('id').single();
  if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'Este PDF já está na sua biblioteca.' : error.message);
  await invoke('material-map', { materialId: (data as { id: string }).id });
}

export const remapMaterial = (id: string) => invoke('material-map', { materialId: id });

export async function deleteMaterial(m: Material) {
  await supabase.storage.from('materiais').remove([m.storage_path]);
  const { error } = await supabase.from('materials').delete().eq('id', m.id);
  if (error) throw new Error(error.message);
}

// Link temporário (1 h) para o leitor baixar o PDF privado.
export async function signedUrl(path: string) {
  const { data, error } = await supabase.storage.from('materiais').createSignedUrl(path, 3600);
  if (error || !data) throw new Error(error?.message ?? 'Não foi possível abrir o PDF.');
  return data.signedUrl;
}
