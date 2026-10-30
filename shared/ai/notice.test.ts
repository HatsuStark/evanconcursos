import { describe, expect, it } from 'vitest';
import { checkNotice, comparableText, NoticeExtraction, noticeJsonSchema, subjectWeights, topicInText } from './notice.ts';

const PDF = `ANEXO VI CONTEÚDO PROGRAMÁTICO
BLOCO I: Língua Portuguesa (16) questões: 1. Análise, compreensão e interpretação de diversos tipos de textos verbais,
não verbais, literários e não literários. 12. Crase. 13. Pontuação.
BLOCO II: Conhecimentos em Direito (30) questões: 1. DIREITO PENAL: Código Penal - artigos 293 a 305; 307; 308.`;

const base: NoticeExtraction = {
  organization: 'TJSP', role: 'Escrevente', otherRoles: [], board: 'VUNESP', examDate: '2030-12-07', totalQuestions: 46,
  stages: [{ kind: 'objetiva', description: '' }],
  blocks: [{ name: 'Bloco I', questions: 16, rule: '' }, { name: 'Bloco II', questions: 30, rule: '' }],
  subjects: [
    { name: 'Língua Portuguesa', block: 'Bloco I', questions: 16, core: false, topics: [{ text: 'Crase.', page: 21 }, { text: '1. Análise, compreensão e interpretação de diversos tipos de textos verbais, não verbais', page: 21 }] },
    { name: 'Direito Penal', block: 'Bloco II', questions: 0, core: true, topics: [{ text: 'Código Penal - artigos 293 a 305; 307; 308.', page: 22 }] },
    { name: 'Direito Civil', block: 'Bloco II', questions: 0, core: true, topics: [{ text: 'Contratos em espécie e responsabilidade civil objetiva', page: 22 }] },
  ],
  notes: [],
};

describe('topicInText', () => {
  const hay = comparableText(PDF);
  it('aceita transcrição fiel (com quebra de linha, numeração e pontuação diferentes)', () => {
    expect(topicInText('Análise, compreensão e interpretação de diversos tipos de textos verbais, não verbais, literários', hay)).toBe(true);
    expect(topicInText('Crase', hay)).toBe(true);
    expect(topicInText('Código Penal – artigos 293 a 305, 307, 308', hay)).toBe(true);
  });
  it('reescrita (abreviações) vira aviso para o usuário conferir', () => {
    expect(topicInText('Código Penal: arts. 293 a 305, 307 e 308', hay)).toBe(false);
  });
  it('rejeita conteúdo que não está no edital', () => {
    expect(topicInText('Contratos em espécie e responsabilidade civil objetiva', hay)).toBe(false);
    expect(topicInText('Regência verbal e nominal', hay)).toBe(false);
  });
});

describe('checkNotice', () => {
  it('aponta tópicos fora do PDF, data passada e soma de blocos', () => {
    const codes = checkNotice({ ...base, examDate: '2020-01-01', totalQuestions: 50 }, PDF).map((w) => w.code);
    expect(codes).toContain('topic_not_found');
    expect(codes).toContain('exam_date_past');
    expect(codes).toContain('total_sum');
  });
  it('edital coerente não gera avisos (exceto o tópico inventado)', () => {
    const w = checkNotice(base, PDF, new Date(2026, 0, 1));
    expect(w.map((x) => x.code)).toEqual(['topic_not_found']);
    expect(w[0]!.subject).toBe('Direito Civil');
  });
  it('sem data, sem tópicos, disciplina repetida, soma do bloco', () => {
    const e: NoticeExtraction = { ...base, examDate: '', subjects: [...base.subjects, { ...base.subjects[0]!, topics: [], questions: 10 }] };
    const codes = checkNotice(e, null).map((x) => x.code);
    expect(codes).toEqual(expect.arrayContaining(['exam_date_missing', 'subject_duplicate', 'subject_no_topics', 'block_sum']));
  });
});

describe('subjectWeights', () => {
  it('pesa por questões; divide o bloco entre as disciplinas sem contagem própria', () => {
    // Português 16; Penal e Civil dividem 30 → 15 cada.
    expect(subjectWeights(base)).toEqual([5, 5, 5]);
    const w = subjectWeights({ ...base, blocks: [{ name: 'Bloco I', questions: 16, rule: '' }, { name: 'Bloco II', questions: 8, rule: '' }] });
    expect(w).toEqual([5, 1, 1]);
  });
});

describe('schema', () => {
  it('JSON Schema para o Gemini sai do mesmo schema Zod', () => {
    const js = noticeJsonSchema() as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(js.properties)).toEqual(expect.arrayContaining(['subjects', 'blocks', 'examDate']));
    expect(js.required).toContain('subjects');
  });
});
