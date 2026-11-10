import { describe, expect, it } from 'vitest';
import { jurisPrompt, MAX_JURIS_PICKS, mergePicks, rankCandidates, refsParam, type JurisCandidate } from './juris.ts';

const c = (id: string, kind: JurisCandidate['kind'], number: number, decided_on: string | null = null): JurisCandidate => ({
  id, court: kind === 'repetitivo' || kind === 'iac' ? 'STJ' : 'STF', kind, number, text: `Texto ${id}`, subject: '', decided_on, source_url: `https://x/${id}`, arts: [{ law: 'CP', art: 171 }],
});
const list = [c('s1', 'sumula', 17, '1990-01-01'), c('r1', 'repetitivo', 900, '2020-01-01'), c('v1', 'sumula_vinculante', 5), c('g1', 'repercussao_geral', 1103, '2021-01-01'), c('r2', 'repetitivo', 901, '2023-01-01')];

describe('jurisprudência da sessão', () => {
  it('ordena por força do precedente e, dentro do tipo, do mais recente', () => {
    expect(rankCandidates(list).map((x) => x.id)).toEqual(['v1', 'g1', 'r2', 'r1', 's1']);
  });

  it('escolhidos primeiro, na ordem da IA, com o comentário; os demais depois, sem comentário', () => {
    const items = mergePicks(list, { itens: [{ n: 4, como_cai: ' Absorção do falso. ' }, { n: 0, como_cai: 'Defesa técnica.' }, { n: 99, como_cai: 'inexistente' }, { n: 4, como_cai: 'repetido' }] });
    expect(items.map((x) => [x.id, x.hot, x.how])).toEqual([['s1', true, 'Absorção do falso.'], ['v1', true, 'Defesa técnica.'], ['g1', false, ''], ['r2', false, ''], ['r1', false, '']]);
    expect(items[0]!.label).toBe('Súmula 17/STF');
  });

  it('sem escolha da IA, lista completa na ordem de força', () => {
    expect(mergePicks(list, null).map((x) => x.hot)).toEqual([false, false, false, false, false]);
  });

  it('limita os destaques', () => {
    const many = Array.from({ length: 20 }, (_, i) => c(`x${i}`, 'sumula', i + 1));
    const items = mergePicks(many, { itens: many.map((_, n) => ({ n, como_cai: 'x' })) });
    expect(items.filter((x) => x.hot)).toHaveLength(MAX_JURIS_PICKS);
    expect(items).toHaveLength(20);
  });

  it('intervalos da sessão viram parâmetros; lei sem intervalo vai inteira', () => {
    expect(refsParam([{ law: 'CP', ranges: [{ from: 312, to: 317 }, { from: 171, to: 171 }] }, { law: 'CF', ranges: [] }]))
      .toEqual([{ law: 'CP', from: 312, to: 317 }, { law: 'CP', from: 171, to: 171 }, { law: 'CF', from: null, to: null }]);
  });

  it('prompt numera os itens na ordem recebida e proíbe acrescentar regra', () => {
    const p = jurisPrompt({ banca: 'FGV', subject: 'Direito Penal', title: 'Estelionato', items: rankCandidates(list) });
    expect(p).toContain('0. Súmula Vinculante 5: Texto v1');
    expect(p).toContain('4. Súmula 17/STF: Texto s1');
    expect(p).toContain('não acrescente regras');
  });
});
