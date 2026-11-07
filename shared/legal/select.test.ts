import { describe, expect, it } from 'vitest';
import { selectArticles } from './select.ts';

const H = 'PARTE GERAL › LIVRO IV – DOS ATOS PROCESSUAIS';
const sec = (heading: string, from: number, count: number) => Array.from({ length: count }, (_, i) => ({ label: String(from + i), num: from + i, suffix: '', text: `Art. ${from + i}`, heading }));
// Recorte da sessão real: juiz (139–149), auxiliares, atos e prazos, citação (238–259), nulidades (276–283), tutela (294–311).
const arts = [
  ...sec('PARTE GERAL › LIVRO III – DOS SUJEITOS DO PROCESSO › TÍTULO IV – DO JUIZ E DOS AUXILIARES DA JUSTIÇA › CAPÍTULO I – DOS PODERES, DOS DEVERES E DA RESPONSABILIDADE DO JUIZ', 139, 5),
  ...sec('PARTE GERAL › LIVRO III – DOS SUJEITOS DO PROCESSO › TÍTULO IV – DO JUIZ E DOS AUXILIARES DA JUSTIÇA › CAPÍTULO III – DOS AUXILIARES DA JUSTIÇA › Seção II – Do Perito', 156, 3),
  ...sec(`${H} › TÍTULO I – DA FORMA, DO TEMPO E DO LUGAR DOS ATOS PROCESSUAIS › CAPÍTULO I – DA FORMA DOS ATOS PROCESSUAIS › Seção I – Dos Atos em Geral`, 188, 10),
  ...sec(`${H} › TÍTULO I – DA FORMA, DO TEMPO E DO LUGAR DOS ATOS PROCESSUAIS › CAPÍTULO III – DOS PRAZOS › Seção I – Disposições Gerais`, 218, 15),
  ...sec(`${H} › TÍTULO II – DA COMUNICAÇÃO DOS ATOS PROCESSUAIS › CAPÍTULO II – DA CITAÇÃO`, 238, 22),
  ...sec(`${H} › TÍTULO III – DAS NULIDADES`, 276, 8),
  ...sec('PARTE GERAL › LIVRO V – DA TUTELA PROVISÓRIA › TÍTULO I – DISPOSIÇÕES GERAIS', 294, 6),
];
const title = 'Juiz, MP, Fazenda, atos processuais, citação, nulidades, tutela provisória: CPC arts. 139 a 149, 156 a 158, 188 a 316';

describe('selectArticles', () => {
  it('cabe tudo: devolve todos, na ordem', () => {
    const r = selectArticles(arts.slice(0, 10), 25, { title });
    expect(r.picked).toHaveLength(10);
    expect(r.omitted).toEqual([]);
  });

  it('não para no começo: todo assunto do título entra, até o fim da sessão', () => {
    const r = selectArticles(arts, 25, { title });
    const nums = r.picked.map((a) => a.num);
    expect(nums).toHaveLength(25);
    for (const first of [139, 188, 238, 276, 294]) expect(nums).toContain(first);
    expect(Math.max(...nums)).toBeGreaterThanOrEqual(294);
    expect(nums).toEqual([...nums].sort((a, b) => a - b)); // na ordem da lei
  });

  it('a cobrança da banca puxa mais artigos para o assunto mais cobrado', () => {
    const count = (r: ReturnType<typeof selectArticles>, from: number, to: number) => r.picked.filter((a) => a.num >= from && a.num <= to).length;
    const plain = selectArticles(arts, 25, { title });
    const hot = selectArticles(arts, 25, { title, incidence: [{ assunto: 'Citação', total: 40 }, { assunto: 'Alegação da Nulidade', total: 2 }] });
    expect(count(hot, 238, 259)).toBeGreaterThan(count(plain, 238, 259));
  });

  it('sem vaga para todas as seções, ficam de fora as que o título não cita, e elas são listadas', () => {
    const r = selectArticles(arts, 5, { title });
    const nums = r.picked.map((a) => a.num);
    for (const first of [139, 188, 238, 276, 294]) expect(nums).toContain(first);
    expect(r.omitted).toEqual(expect.arrayContaining(['Seção II – Do Perito', 'Seção I – Disposições Gerais']));
  });

  it('os mais cobrados (IA) entram antes dos vizinhos e puxam vagas para a seção', () => {
    const marked = arts.map((a) => ({ ...a, hot: a.num === 296 || a.num === 297 || a.num === 298 }));
    const nums = selectArticles(marked, 25, { title }).picked.map((a) => a.num);
    const plain = selectArticles(arts, 25, { title }).picked.map((a) => a.num);
    for (const n of [296, 297, 298]) expect(nums).toContain(n);
    expect([296, 297, 298].every((n) => plain.includes(n))).toBe(false);
  });
});
