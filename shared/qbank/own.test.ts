import { describe, expect, it } from 'vitest';
import { citesMissingText, ownHtml, ownQid, ownRows, type OwnExam } from './own.ts';

const q = (over: Partial<OwnExam['questoes'][number]> = {}): OwnExam['questoes'][number] => ({
  numero: 1, enunciado: 'Qual é a **capital**?', alternativas: [{ letra: 'A', texto: 'X' }, { letra: 'B', texto: 'Y' }], gabarito: 'B',
  anulada: false, texto_associado: null, depende_visual: false,
  classificacao: { materia: 'Geografia', assunto: 'Capitais', dificuldade: 4, desatualizada: false }, ...over,
});
const exam = (questoes: OwnExam['questoes']): OwnExam => ({
  prova: { banca: 'Fgv', orgao: 'TJ', cargo: 'Técnico', ano: 2024, formato: 'multipla escolha' },
  classificacao: { banca: 'FGV', carreiras: ['Jurídica'] }, textos: { T1: 'Texto <um>\n\nsegundo' }, questoes,
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
      textos: ['<p>Texto &lt;um&gt;</p><p>segundo</p>'], enunciado: '<p>Qual é a <strong>capital</strong>?</p>',
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
});
