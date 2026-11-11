import { describe, expect, it } from 'vitest';
import { MAX_CARDS, allReviewCards, asksRecall, buildReviewDeck, emptyMemory, rememberAnswers, suggestVerdict, type ReviewSheet } from './review-cards.ts';

const sheet: ReviewSheet = {
  perguntas: [{ pergunta: 'Pena do peculato?', resposta: 'Reclusão de 2 a 12 anos e multa.' }],
  gatilhos: [
    { pista: 'Sem a posse, subtrai valendo-se do cargo', resposta: 'Peculato-furto' },
    { pista: 'Recebeu por erro de outrem', resposta: 'Peculato mediante erro de outrem' },
  ],
  mnemonicos: [{ alvo: 'Modalidades', mnemonico: 'ADFC', explicacao: 'Apropriação, Desvio, Furto, Culposo' }],
  memorizar: ['Reparação antes da sentença irrecorrível extingue a punibilidade.', 'Depois, reduz pela metade.'],
  pegadinhas: ['Troca sentença irrecorrível por recebimento da denúncia.'],
};

describe('review cards', () => {
  it('turns every item into a card with stable ids', () => {
    const a = allReviewCards(sheet), b = allReviewCards(structuredClone(sheet));
    expect(a).toHaveLength(7);
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    expect(new Set(a.map((c) => c.id)).size).toBe(7);
  });

  it('skips empty items', () => {
    expect(allReviewCards({ perguntas: [{ pergunta: ' ', resposta: 'x' }], memorizar: ['', '  '] })).toEqual([]);
  });

  it('puts a reading card after every two recall cards', () => {
    const types = buildReviewDeck(sheet).cards.map((c) => (asksRecall(c.type) ? 'a' : 'r')).join('');
    expect(types).toBe('aaraarr');
  });

  it('drops known cards, puts missed first and prefers unread reading cards', () => {
    const all = allReviewCards(sheet);
    const cue1 = all.find((c) => c.front.startsWith('Sem a posse'))!, rec = all.find((c) => c.type === 'recall')!, memo1 = all.find((c) => c.type === 'memo')!;
    const mem = rememberAnswers(emptyMemory(), { [cue1.id]: 'know', [rec.id]: 'again', [memo1.id]: 'read' });
    const { cards, restarted } = buildReviewDeck(sheet, mem);
    expect(restarted).toBe(false);
    expect(cards.map((c) => c.id)).not.toContain(cue1.id);
    expect(cards[0]!.id).toBe(rec.id);
    expect(cards.filter((c) => !asksRecall(c.type)).at(-1)!.id).toBe(memo1.id);
  });

  it('restarts the whole deck when everything is known', () => {
    const all = allReviewCards(sheet);
    const mem = rememberAnswers(emptyMemory(), Object.fromEntries(all.filter((c) => asksRecall(c.type)).map((c) => [c.id, 'know' as const])));
    const deck = buildReviewDeck(sheet, mem);
    expect(deck.restarted).toBe(true);
    expect(deck.cards.filter((c) => asksRecall(c.type))).toHaveLength(4);
    expect(rememberAnswers(mem, {}, true).known).toEqual([]);
  });

  it('caps the deck size', () => {
    const big: ReviewSheet = { gatilhos: Array.from({ length: 30 }, (_, i) => ({ pista: `p${i}`, resposta: `r${i}` })), memorizar: Array.from({ length: 10 }, (_, i) => `m${i}`) };
    expect(buildReviewDeck(big).cards).toHaveLength(MAX_CARDS);
  });

  it('suggests a verdict from the score', () => {
    expect(suggestVerdict(4, 5)).toBe('lembrei');
    expect(suggestVerdict(3, 5)).toBe('parcial');
    expect(suggestVerdict(2, 5)).toBe('esqueci');
    expect(suggestVerdict(0, 0)).toBe('lembrei');
  });
});
