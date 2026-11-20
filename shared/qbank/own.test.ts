import { describe, expect, it } from 'vitest';
import { citesMissingText, lacksMark, lacksText, ownHtml, ownQid, ownRows, type OwnExam } from './own.ts';

const q = (over: Partial<OwnExam['questoes'][number]> = {}): OwnExam['questoes'][number] => ({
  numero: 1, enunciado: 'Qual é a **capital**?', alternativas: [{ letra: 'A', texto: 'X' }, { letra: 'B', texto: 'Y' }], gabarito: 'B',
  anulada: false, texto_associado: null, depende_visual: false,
  classificacao: { materia: 'Geografia', assunto: 'Capitais', dificuldade: 4, desatualizada: false }, ...over,
});
const exam = (questoes: OwnExam['questoes']): OwnExam => ({
  prova: { banca: 'Fgv', orgao: 'TJ', cargo: 'Técnico', ano: 2024, formato: 'multipla escolha' },
  classificacao: { banca: 'FGV', carreiras: ['Jurídica'] }, textos: { T1: 'Texto <um> sobre a cidade\n\nsegundo parágrafo' }, questoes,
});

describe('banco próprio', () => {
  it('converte texto em HTML seguro com destaques e parágrafos', () => {
    expect(ownHtml('a <b> **forte**\nlinha\n\nnovo')).toBe('<p>a &lt;b&gt; <strong>forte</strong><br>linha</p><p>novo</p>');
  });

  it('gera linha no formato público, com banca e carreiras da classificação', () => {
    const { rows } = ownRows(exam([q({ texto_associado: 'T1' })]), (n) => `own-${n}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ qid: 'own-1', materia: 'Geografia', assunto: 'Capitais', gabarito: 'B' });
    expect(rows[0]!.payload).toMatchObject({
      tipo: 'multipla escolha', dificuldade: 4, prova: { banca: 'FGV', ano: 2024 }, carreiras: ['Jurídica'], fonte: 'propria',
      textos: ['<p>Texto &lt;um&gt; sobre a cidade</p><p>segundo parágrafo</p>'], enunciado: '<p>Qual é a <strong>capital</strong>?</p>',
    });
  });

  it('certo/errado sem alternativas', () => {
    const { rows } = ownRows(exam([q({ alternativas: [], gabarito: 'e' })]), String);
    expect(rows[0]!.payload.tipo).toBe('certo e errado');
    expect(rows[0]!.gabarito).toBe('E');
  });

  it('descarta anulada, imagem, desatualizada, sem matéria e gabarito inválido', () => {
    const { rows, skipped } = ownRows(exam([
      q({ anulada: true }), q({ depende_visual: true }), q({ classificacao: undefined }), q({ gabarito: 'Z' }),
      q({ classificacao: { materia: 'Geografia', assunto: '', dificuldade: 3, desatualizada: true } }),
    ]), String);
    expect(rows).toEqual([]);
    expect(skipped).toEqual({ anulada: 1, imagem: 1, 'sem matéria': 1, gabarito: 1, desatualizada: 1 });
  });

  it('id estável sem dois-pontos', () => {
    const id = ownQid(() => 'abcdef0123456789ffff', 'prova-x', 3);
    expect(id).toBe('own-abcdef0123456789');
    expect(id).toMatch(/^[\w-]+$/);
  });

  it('descarta questão de interpretação que cita um texto que não veio', () => {
    const port = { materia: 'Língua Portuguesa', assunto: 'Interpretação de Texto', dificuldade: 3, desatualizada: false };
    const { rows, skipped, dropped } = ownRows(exam([
      q({ numero: 1, enunciado: 'O parágrafo final do texto permite concluir que a personagem optou por', classificacao: port }),
      q({ numero: 2, enunciado: 'O parágrafo final do texto permite concluir que a personagem optou por', classificacao: port, texto_associado: 'T1' }),
    ]), (n) => `own-${n}`);
    expect(rows.map((r) => r.qid)).toEqual(['own-2']);
    expect(skipped).toEqual({ 'sem texto': 1 });
    expect(dropped).toEqual(['own-1']);
  });

  it('só considera falta de texto em Português e quando o trecho não vem no enunciado', () => {
    expect(citesMissingText('A história narrada apresenta a personagem em uma situação de', 'Interpretação de Texto')).toBe(true);
    expect(citesMissingText('De acordo com o texto, o autor defende', 'Língua Portuguesa')).toBe(true);
    expect(citesMissingText('Segundo o texto constitucional, compete à União', 'Direito Constitucional')).toBe(false);
    expect(citesMissingText('No texto, o termo destacado em “casa velha” exerce', 'Língua Portuguesa')).toBe(false);
    expect(citesMissingText('Leia o texto a seguir e responda.', 'Língua Portuguesa')).toBe(false);
    expect(citesMissingText('Na redação oficial, o fecho do texto deve', 'Língua Portuguesa')).toBe(false);
  });

  it('pega as da Quest: quebra de linha do PDF, referente de termo citado e texto pelo código do Cebraspe', () => {
    expect(citesMissingText('Assinale a afirmação correta a respeito do conteúdo do\ntexto.', 'Língua Portuguesa')).toBe(true);
    expect(citesMissingText('No terceiro parágrafo do texto, o pronome “Isso” refere-se', 'Língua Portuguesa')).toBe(true);
    expect(citesMissingText('Sem prejuízo para os sentidos do texto CB1A1AAA, a expressão “e não” (l. 28 e 29) poderia ser substituída por', 'Língua Portuguesa')).toBe(true);
    expect(citesMissingText('A partir da leitura da tira, é correto afirmar que', 'Língua Portuguesa')).toBe(true);
    expect(citesMissingText('O humor dessa tirinha decorre', 'Interpretação de Texto')).toBe(true);
    expect(citesMissingText('No último quadrinho, a fala da personagem sugere', 'Língua Portuguesa')).toBe(true);
    expect(citesMissingText('A charge critica', 'Língua Portuguesa')).toBe(true);
    expect(citesMissingText('No poema, o eu lírico', 'Língua Portuguesa')).toBe(true);
    expect(citesMissingText('Considere a tira: “Por que os adultos ficam dizendo coisas?”. O humor decorre', 'Língua Portuguesa')).toBe(false);
    expect(citesMissingText('Assinale a alternativa em que a palavra “tira” está empregada no sentido de policial', 'Língua Portuguesa')).toBe(false);
    expect(citesMissingText('No que se refere à redação oficial, julgue o item. A linguagem deve ser clara para a compreensão do texto.', 'Língua Portuguesa')).toBe(false);
    expect(citesMissingText('Um dos microrganismos tinha cerca de 48.500 anos, o que o torna o vírus mais antigo já revivido até hoje. (L.15-17) No período acima, há', 'Língua Portuguesa')).toBe(false);
  });

  it('lacksText lê o HTML do payload e aceita anexo no lugar do texto', () => {
    const p = { enunciado: 'De acordo com as informações do texto, uma pessoa<br>imediatista', textos: [], anexos: [], materia: 'Língua Portuguesa' };
    expect(lacksText(p)).toBe(true);
    expect(lacksText({ ...p, textos: ['<p>Texto completo, com o trecho que a questão cita.</p>'] })).toBe(false);
    expect(lacksText({ ...p, anexos: ['https://x/tira.png'] })).toBe(false);
  });

  it('lacksMark: fala em termo destacado e nada vem marcado em lugar nenhum', () => {
    const p = { enunciado: '<p>No fragmento “A voracidade da acumulação...”, os termos destacados significam:</p>', alternativas: [{ texto: '<p>avidez</p>' }], textos: [], anexos: [] };
    expect(lacksMark(p)).toBe(true);
    expect(lacksMark({ ...p, enunciado: '<p>No fragmento “A <strong>voracidade</strong>...”, o termo destacado significa:</p>' })).toBe(false);
    expect(lacksMark({ ...p, alternativas: [{ texto: '<p>A <b>casa</b> caiu.</p>' }] })).toBe(false);
    expect(lacksMark({ ...p, textos: ['<p>A <u>voracidade</u></p>'] })).toBe(false);
    expect(lacksMark({ ...p, anexos: ['https://x/img.png'] })).toBe(false);
    expect(lacksMark({ ...p, enunciado: '<p>Qual é a capital?</p>' })).toBe(false);
  });

  it('ownRows descarta a que cita termo destacado sem marcar', () => {
    const exam: OwnExam = { prova: { banca: 'VUNESP', orgao: 'X', cargo: 'Y', ano: 2026, formato: 'me' }, questoes: [
      q({ numero: 1, enunciado: 'Os termos destacados em “a voracidade impeliu” significam:' }),
      q({ numero: 2, enunciado: 'Os termos destacados em “a **voracidade** **impeliu**” significam:' }),
    ] };
    const r = ownRows(exam, (n) => `own-${n}`);
    expect(r.rows.map((x) => x.qid)).toEqual(['own-2']);
    expect(r.skipped['sem destaque']).toBe(1);
    expect(r.dropped).toEqual(['own-1']);
  });
});

describe('texto associado que é só a fonte', () => {
  const base = { materia: 'Língua Portuguesa', anexos: [] as string[] };
  it('crédito sozinho não conta como texto', () => {
    expect(lacksText({ ...base, enunciado: 'A partir da leitura da tira, é correto afirmar que Calvin', textos: ['<p>(Disponível em: https://blogdoxandro.blogspot.com/2023/03/tiras-n17285-calvin-haroldo-bill.html.)</p>'] })).toBe(true);
    expect(lacksText({ ...base, enunciado: 'Assinale a alternativa que explica o efeito de humor da tira.', textos: ['<p>(Fernando Gonsales. https://www.instagram.com/p/DMcftWRuYzt/?img_index=5)</p>'] })).toBe(true);
  });
  it('transcrição com a fonte no fim continua valendo', () => {
    expect(lacksText({ ...base, enunciado: 'O humor dessa tira decorre', textos: ['<p>Tirinha da Mafalda: Susanita pergunta por que os adultos dizem coisas que a gente não entende.</p><p>(Quino. Mafalda. Disponível em: www.pinterest.com)</p>'] })).toBe(false);
  });
  it('editorial, pesquisa e dados apresentados sem texto', () => {
    expect(lacksText({ ...base, enunciado: 'As informações do editorial permitem inferir corretamente que', textos: [] })).toBe(true);
    expect(lacksText({ ...base, enunciado: 'Com base nos dados apresentados da pesquisa, conclui-se corretamente que', textos: [] })).toBe(true);
  });
});
