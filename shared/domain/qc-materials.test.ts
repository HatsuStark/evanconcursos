import { describe, expect, it } from 'vitest';
import { lawLinks, studyLinks } from './materials.ts';
import { isQcUrl, qcUrl } from './qc.ts';
import { WEAK_MARK } from './scheduler.ts';

const BASE = 'https://www.qconcursos.com/questoes-de-concursos/questoes?discipline_ids%5B%5D=560&examining_board_ids%5B%5D=152&job_ids%5B%5D=281&publication_year%5B%5D=2025&my_questions=all&q=velho';

describe('qcUrl', () => {
  it('link da matéria: mantém tudo, troca assunto/modo, ajusta dificuldade', () => {
    const u = new URL(qcUrl({ subject: 'Penal', keyword: 'dolo', mode: 'not_resolved', accuracy: 0.5, subjectLink: BASE }));
    expect(u.searchParams.get('discipline_ids[]')).toBe('560');
    expect(u.searchParams.get('q')).toBe('dolo');
    expect(u.searchParams.get('my_questions')).toBe('not_resolved');
    expect(u.searchParams.getAll('difficulty[]')).toEqual(['2', '3']);
  });
  it('filtro base: só campos comuns (sem disciplina); sem link usa a matéria como busca', () => {
    const u = new URL(qcUrl({ subject: 'Português', keyword: '', mode: 'wrong', baseLink: BASE }));
    expect(u.searchParams.get('examining_board_ids[]')).toBe('152');
    expect(u.searchParams.get('discipline_ids[]')).toBeNull();
    expect(u.searchParams.get('q')).toBe('Português');
    expect(u.searchParams.getAll('difficulty[]')).toEqual([]);
  });
  it('ignora links que não são do QConcursos', () => {
    expect(isQcUrl('https://evil.example/questoes')).toBe(false);
    expect(new URL(qcUrl({ subject: 'X', keyword: '', mode: 'all', subjectLink: 'https://evil.example/?q=1' })).hostname).toBe('www.qconcursos.com');
  });
});

describe('materiais', () => {
  const labels = (l: { label: string }[]) => l.map((x) => x.label);
  it('lei seca por código citado, por número de lei e pela matéria', () => {
    expect(labels(lawLinks('CPP: Inquérito policial, arts. 4º a 23'))).toEqual(['Lei seca: CPP']);
    const l = lawLinks('Lei 8.429/92: improbidade; Lei 10.261/68 estatuto');
    expect(l[0]).toMatchObject({ label: 'Lei seca: Lei 8.429/92', href: 'https://www.planalto.gov.br/ccivil_03/leis/l8429.htm' });
    expect(l[1]!.href).toContain('google.com/search');
    expect(labels(lawLinks('estudo geral', 'Direito Processual Penal'))).toEqual(['Lei seca: CPP']);
  });
  it('buscas pelo tema; dia de reforço busca só pela matéria; termos e leituras da IA', () => {
    const s = studyLinks({ subject: 'Português', keyword: 'Crase', text: 'Português: Crase' }, { searches: ['crase vunesp'], readings: ['Código Civil art. 1'] });
    expect(labels(s)).toEqual(['Vídeo-aulas', 'PDFs e resumos', '▶ crase vunesp', 'Lei seca: Código Civil']);
    expect(decodeURIComponent(s[0]!.href)).toContain('Português+Crase+aula');
    const w = studyLinks({ subject: 'Direito Penal', keyword: WEAK_MARK, text: 'Direito Penal: questões dos pontos fracos' });
    expect(decodeURIComponent(w[0]!.href)).toContain('search_query=Direito+Penal+aula');
  });
});
