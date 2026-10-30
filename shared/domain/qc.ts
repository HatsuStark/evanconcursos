// Filtro do QConcursos (formulário GET de /questoes-de-concursos/questoes).
// Ponto de partida: o link salvo da matéria (completo) ou, na falta dele, o filtro base do concurso,
// do qual só se aproveitam os campos comuns a todas as matérias (banca, cargo, anos...).
// O foco ajusta o resto: `q` = assunto, `my_questions` = modo e `difficulty[]` pelo acerto.
import { difficultyFor } from './adaptive.ts';

export const QC_QUESTIONS = 'https://www.qconcursos.com/questoes-de-concursos/questoes';
export const QC_BASE_KEYS = ['examining_board_ids[]', 'job_ids[]', 'institute_ids[]', 'publication_year[]', 'scholarity_ids[]', 'administrative_level_ids[]', 'modality_ids[]', 'sort', 'per_page'];
export type QcMode = 'all' | 'resolved' | 'not_resolved' | 'correct' | 'wrong';

export function isQcUrl(u: string): boolean {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && (x.hostname === 'qconcursos.com' || x.hostname.endsWith('.qconcursos.com'));
  } catch { return false; }
}

export interface QcQuery {
  subject: string; keyword: string; mode: QcMode;
  accuracy?: number | null; subjectLink?: string | null; baseLink?: string | null;
}

export function qcUrl({ subject, keyword, mode, accuracy = null, subjectLink, baseLink }: QcQuery): string {
  const own = subjectLink && isQcUrl(subjectLink) ? subjectLink : '', base = baseLink && isQcUrl(baseLink) ? baseLink : '';
  const url = new URL(QC_QUESTIONS), p = url.searchParams;
  if (own) url.search = new URL(own).search;
  else if (base) for (const [k, v] of new URL(base).searchParams) if (QC_BASE_KEYS.includes(k)) p.append(k, v);
  for (const k of ['q', 'my_questions', 'page', 'difficulty[]']) p.delete(k);
  const q = keyword || (own ? '' : subject);
  if (q) p.set('q', q);
  p.set('my_questions', mode);
  if (mode === 'not_resolved' && accuracy != null) difficultyFor(accuracy).forEach((d) => p.append('difficulty[]', d));
  p.set('exclude_nullified', 'true');
  p.set('exclude_outdated', 'true');
  return url.href;
}
