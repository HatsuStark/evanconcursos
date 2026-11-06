import { describe, expect, it, vi } from 'vitest';
import { checkNotice, comparableText, extractWithRetry, fillMissingTopics, NOTICE_DEADLINE_MS, mergeNoticeParts, noticePrompt, NoticeExtraction, noticeJsonSchema, noticeSpecificJsonSchema, subjectWeights, topicInText, uniqueRoles } from './notice.ts';

describe('extractWithRetry', () => {
  const recitation = Object.assign(new Error('O Gemini não devolveu conteúdo (RECITATION).'), { finishReason: 'RECITATION' });
  it('sem recusa, uma tentativa só', async () => {
    const attempt = vi.fn().mockResolvedValue('ok');
    expect(await extractWithRetry(attempt)).toBe('ok');
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(attempt.mock.calls[0]![0]).toMatchObject({ retry: false, timeoutMs: NOTICE_DEADLINE_MS });
  });
  it('recusa RECITATION tenta de novo com mais variação, só no tempo que sobra', async () => {
    let t = 0;
    const attempt = vi.fn().mockImplementationOnce(async () => { t = 40_000; throw recitation; }).mockResolvedValueOnce('ok');
    expect(await extractWithRetry(attempt, () => t)).toBe('ok');
    expect(attempt.mock.calls[1]![0]).toEqual({ temperature: 0.7, retry: true, timeoutMs: NOTICE_DEADLINE_MS - 40_000 });
  });
  it('sem tempo para outra tentativa, falha com mensagem clara e guarda a causa', async () => {
    let t = 0;
    const attempt = vi.fn().mockImplementation(async () => { t = NOTICE_DEADLINE_MS - 1000; throw recitation; });
    const e = await extractWithRetry(attempt, () => t).catch((x: Error) => x) as Error;
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(e.message).toContain('recusou transcrever');
    expect(e.cause).toBe(recitation);
  });
  it('duas recusas: falha com a mesma mensagem clara', async () => {
    const e = await extractWithRetry(vi.fn().mockRejectedValue(recitation)).catch((x: Error) => x) as Error;
    expect(e.message).toContain('recusou transcrever');
  });
  it('tópico acima do limite (parágrafo corrido) tenta de novo pedindo para quebrar os itens', async () => {
    const long = new Error('A resposta do Gemini não segue o schema: subjects.4.topics.0.text: Too big: expected string to have <=2000 characters');
    const attempt = vi.fn().mockRejectedValueOnce(long).mockResolvedValueOnce('ok');
    expect(await extractWithRetry(attempt)).toBe('ok');
    expect(attempt.mock.calls[1]![0]).toMatchObject({ temperature: 0.2, retry: true });
    const e = await extractWithRetry(vi.fn().mockRejectedValue(long)).catch((x: Error) => x) as Error;
    expect(e.message).toContain('não separou os itens');
    expect(e.cause).toBe(long);
  });
  it('outro erro não gasta nova tentativa', async () => {
    const boom = new Error('rede'), attempt = vi.fn().mockRejectedValue(boom);
    await expect(extractWithRetry(attempt)).rejects.toBe(boom);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
  it('só a nova tentativa pede para quebrar os itens', () => {
    expect(noticePrompt('')).not.toContain('quebre itens longos');
    expect(noticePrompt('', true)).toContain('quebre itens longos');
  });
});

const PDF = `ANEXO VI CONTEÚDO PROGRAMÁTICO
BLOCO I: Língua Portuguesa (16) questões: 1. Análise, compreensão e interpretação de diversos tipos de textos verbais,
não verbais, literários e não literários. 12. Crase. 13. Pontuação.
BLOCO II: Conhecimentos em Direito (30) questões: 1. DIREITO PENAL: Código Penal - artigos 293 a 305; 307; 308.`;

const base: NoticeExtraction = {
  organization: 'TJSP', role: 'Escrevente', otherRoles: [], roleDuties: '', educationLevel: 'Médio', board: 'VUNESP', examDate: '2030-12-07', totalQuestions: 46,
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

describe('escolha do cargo na lista do edital', () => {
  it('cargo exato: nome literal, código e demais cargos proibidos, sem "o mais próximo"', () => {
    const p = noticePrompt('AGENTE ESCOLAR', false, { code: '102', otherRoles: ['AGENTE DE SEGURANÇA ESCOLAR', 'AGENTE ESCOLAR', 'COZINHEIRO ESCOLAR'] });
    expect(p).toContain('use exatamente o cargo "AGENTE ESCOLAR" (código 102)');
    expect(p).toContain('"AGENTE DE SEGURANÇA ESCOLAR"');
    expect(p).not.toContain('mais próximo');
    expect(p).not.toContain('"AGENTE ESCOLAR", "AGENTE DE');
    expect(p).toContain('o trecho do cargo vizinho');
  });
  it('cargo digitado mantém a busca pelo mais próximo', () => {
    expect(noticePrompt('Escrevente')).toContain('(ou o mais próximo dele)');
  });
  it('lista sem repetidos nem nomes vazios', () => {
    const r = (name: string, code = '') => ({ name, code, educationLevel: '' as const });
    expect(uniqueRoles([r('Agente Escolar', '102'), r('AGENTE ESCOLAR', '102'), r('Agente de Segurança Escolar', '101'), r(' - ')]).map((x) => x.name))
      .toEqual(['Agente Escolar', 'Agente de Segurança Escolar']);
  });
});

describe('leitura em duas partes', () => {
  const sub = (name: string, core: boolean, topics: string[] = []) => ({ name, block: '', questions: 0, core, topics: topics.map((text) => ({ text, page: 1 })) });
  const main = { ...base, subjects: [sub('Língua Portuguesa', false, ['Ortografia.']), sub('Direito Tributário', true), sub('Legislação Aduaneira', true)] };
  it('tópicos das específicas vão para a disciplina de mesmo nome; básicas ficam', () => {
    const spec = { subjects: [{ name: 'DIREITO TRIBUTÁRIO', topics: [{ text: '1. Competência Tributária.', page: 29 }] }, { name: 'Legislação Aduaneira', topics: [{ text: '1. Jurisdição Aduaneira.', page: 30 }] }, { name: 'Língua Portuguesa', topics: [{ text: 'Outra coisa.', page: 2 }] }] };
    const m = mergeNoticeParts(main, spec);
    expect(m.subjects.map((s) => [s.name, s.topics.map((t) => t.text)])).toEqual([
      ['Língua Portuguesa', ['Ortografia.']], ['Direito Tributário', ['1. Competência Tributária.']], ['Legislação Aduaneira', ['1. Jurisdição Aduaneira.']],
    ]);
  });
  it('específica que a leitura principal não listou entra no fim; parte vazia não apaga nada', () => {
    const m = mergeNoticeParts(main, { subjects: [{ name: 'Direito Previdenciário', topics: [{ text: 'Seguridade.', page: 30 }] }] });
    expect(m.subjects.at(-1)).toMatchObject({ name: 'Direito Previdenciário', core: true, topics: [{ text: 'Seguridade.' }] });
    expect(mergeNoticeParts(main, { subjects: [] })).toEqual(main);
  });
  it('cada parte pede o seu pedaço', () => {
    expect(noticePrompt('Auditor', false, undefined, 'general')).toContain('transcreva só as disciplinas de conhecimentos gerais/básicos');
    expect(noticePrompt('Auditor', false, undefined, 'specific')).toContain('Liste só as disciplinas de conhecimentos específicos');
    expect(noticePrompt('Auditor')).not.toContain('lido à parte');
    expect(noticeSpecificJsonSchema()).toMatchObject({ required: ['subjects'] });
  });
});

describe('passada extra de tópicos', () => {
  const base = { title: '', organization: '', role: 'Juiz', roleDuties: '', educationLevel: '' as const, board: '', examDate: '', totalQuestions: 100, notes: [], blocks: [], stages: [], otherRoles: [] };
  const e = { ...base, subjects: [
    { name: 'Direito Civil', block: 'Bloco I', questions: 0, core: true, topics: [] },
    { name: 'Direito Penal', block: 'Bloco II', questions: 0, core: true, topics: [{ text: 'Do crime.', page: 49 }] },
  ] } as unknown as NoticeExtraction;

  it('preenche só a disciplina sem tópicos, pelo nome', () => {
    const r = fillMissingTopics(e, { subjects: [
      { name: 'DIREITO CIVIL', topics: [{ text: 'Pessoas naturais.', page: 39 }] },
      { name: 'Direito Penal', topics: [{ text: 'Outro texto.', page: 50 }] },
    ] });
    expect(r.subjects[0]!.topics.map((t) => t.text)).toEqual(['Pessoas naturais.']);
    expect(r.subjects[1]!.topics.map((t) => t.text)).toEqual(['Do crime.']);
  });

  it('não cria disciplina nova nem apaga a lacuna sem resposta', () => {
    const r = fillMissingTopics(e, { subjects: [{ name: 'Direito Eleitoral', topics: [{ text: 'Partidos.', page: 57 }] }] });
    expect(r.subjects).toHaveLength(2);
    expect(r.subjects[0]!.topics).toEqual([]);
  });
});
