import { describe, expect, it } from 'vitest';
import { guideCacheKey, lawKeys, pickSimilarGuide, topicKeys } from './guide.ts';

const law = [{ ref: 'CP, art. 312', text: 'x'.repeat(100) }, { ref: 'CP, art. 313', text: 'y'.repeat(80) }];
const base = { depth: 'completa' as const, subject: 'Direito Penal', banca: 'VUNESP', topics: ['Peculato', 'Concussão'], law };

describe('reaproveitamento de apostilas', () => {
  it('chave não depende do título nem da ordem/acentos dos tópicos', () => {
    expect(guideCacheKey(base)).toBe(guideCacheKey({ ...base, topics: ['concussao', 'PECULATO'], law: [...law].reverse() }));
    expect(guideCacheKey(base)).not.toBe(guideCacheKey({ ...base, depth: 'revisao' }));
    expect(guideCacheKey(base)).not.toBe(guideCacheKey({ ...base, topics: ['Peculato'] }));
  });
  it('acha apostila semelhante (mesmos artigos, tópicos parecidos) e recusa as diferentes', () => {
    const t = { topics: topicKeys(['Peculato', 'Concussão', 'Corrupção passiva']), law: lawKeys(law) };
    const cands = [
      { topic_keys: topicKeys(['Peculato']), sources: ['CP, art. 327'] },                      // outros artigos
      { topic_keys: topicKeys(['Peculato', 'Concussão']), sources: lawKeys(law) },              // serve
      { topic_keys: topicKeys(['Furto', 'Roubo']), sources: lawKeys(law) },                     // tópicos diferentes
    ];
    expect(pickSimilarGuide(t, cands)).toBe(1);
    expect(pickSimilarGuide(t, [cands[0]!, cands[2]!])).toBe(-1);
  });
  it('sem lei, só reaproveita com tópicos quase iguais', () => {
    const t = { topics: topicKeys(['Crase', 'Regência verbal']), law: [] };
    expect(pickSimilarGuide(t, [{ topic_keys: topicKeys(['Regência verbal', 'Crase']), sources: [] }])).toBe(0);
    expect(pickSimilarGuide(t, [{ topic_keys: topicKeys(['Crase']), sources: [] }])).toBe(-1);
  });
});
