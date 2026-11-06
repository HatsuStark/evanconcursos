import { describe, expect, it } from 'vitest';
import { NoticeExtraction, NoticeTopic } from './notice.ts';

describe('limites do schema do edital', () => {
  it('campo descritivo longo é cortado, sem derrubar a leitura', () => {
    const duties = 'Ministra aulas e cuida do aluno. '.repeat(100);
    const r = NoticeExtraction.shape.roleDuties.parse(`  ${duties}  `);
    expect(r).toHaveLength(2000);
    expect(r.startsWith('Ministra aulas')).toBe(true);
  });
  it('item do conteúdo longo continua sendo erro, para a nova tentativa dividir o item', () => {
    expect(() => NoticeTopic.parse({ text: 'x'.repeat(2001), page: 1 })).toThrow();
  });
});

describe('prompt das atribuições', () => {
  it('pede resumo das atribuições longas, sem perder tarefa', async () => {
    const { noticePrompt } = await import('./notice.ts');
    expect(noticePrompt('Professor')).toMatch(/Se passarem de 1800 caracteres, resuma: mantenha cada tarefa distinta do cargo/);
  });
});

describe('PDF que é só a retificação', () => {
  const vazio = { subjects: [] };
  const completo = { subjects: [{ topics: Array.from({ length: 30 }, (_, i) => ({ text: `Tópico ${i}`, page: 1 })) }] } as never;
  const retificacao = 'PREFEITURA MUNICIPAL DE CANITAR. EDITAL DE RETIFICAÇÃO Nº 01 DO PROCESSO SELETIVO Nº 001/2026. Onde se lê: "06/12/2026", leia-se: "13/12/2026". Ficam mantidas as demais disposições.';
  it('reconhece as marcas de alteração num texto curto com leitura vazia', async () => {
    const { looksLikeAmendmentOnly, checkNotice } = await import('./notice.ts');
    expect(looksLikeAmendmentOnly(vazio, retificacao)).toBe(true);
    expect(looksLikeAmendmentOnly(vazio, 'O item 4.10 passa a vigorar com a seguinte redação: a prova será em 13/12/2026.')).toBe(true);
    expect(checkNotice({ ...vazio, examDate: '', blocks: [], stages: [], totalQuestions: 0 } as never, retificacao).map((w) => w.code)).toContain('amendment_only');
  });
  it('edital completo, mesmo citando retificações, não dispara', async () => {
    const { looksLikeAmendmentOnly } = await import('./notice.ts');
    expect(looksLikeAmendmentOnly(completo, retificacao)).toBe(false);
    expect(looksLikeAmendmentOnly(vazio, 'Acompanhe datas e possíveis retificações do Edital no site da banca.')).toBe(false);
    expect(looksLikeAmendmentOnly(vazio, `${retificacao} ${'conteúdo programático '.repeat(3000)}`)).toBe(false);
    expect(looksLikeAmendmentOnly(vazio, null)).toBe(false);
  });
});
