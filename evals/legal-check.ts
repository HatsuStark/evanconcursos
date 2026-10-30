// Confere o separador de artigos nos textos reais do normas.leg.br. Uso: node --experimental-strip-types evals/legal-check.ts CF CP CPP
import { parseLawHtml } from '../shared/legal/parse.ts';
import { lawByKey } from '../shared/legal/registry.ts';

for (const key of process.argv.slice(2)) {
  const law = lawByKey(key)!;
  const meta = await (await fetch(`https://normas.leg.br/api/public/normas?urn=${law.urn}&tipo_documento=maior-detalhe`)).json() as { encoding?: { version: string; contentUrl: string }[] };
  const enc = meta.encoding?.find((e) => e.version === 'Current') ?? meta.encoding?.[0];
  const html = await (await fetch(enc!.contentUrl.replace('/api/binario/', '/api/public/binario/'))).text();
  const arts = parseLawHtml(html);
  const dup = arts.filter((a) => /\(\d+\)$/.test(a.label)).length;
  const show = (l: string) => { const a = arts.find((x) => x.label === l); return a ? `${l}: ${a.text.slice(0, 90).replace(/\n/g, ' / ')}… [${a.heading.slice(-60)}]${a.revoked ? ' REVOGADO' : ''}` : `${l}: NÃO ENCONTRADO`; };
  console.log(`\n${key} (${enc!.version}): ${arts.length} artigos · ${arts.filter((a) => a.revoked).length} revogados · ${dup} rótulos repetidos · último: ${arts.at(-1)?.label}`);
  for (const l of key === 'CF' ? ['5', '37', '92', 'ADCT 1'] : key === 'CP' ? ['1', '121', '312', '327'] : ['4', '35', '312', '621']) console.log('  ' + show(l));
}
