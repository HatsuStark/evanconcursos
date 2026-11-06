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
