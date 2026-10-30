// Extrai o texto de PDFs, página a página. Uso: node evals/pdf-text.mjs <pasta-saída> <arquivos.pdf...>
import { readFileSync, writeFileSync } from 'node:fs';
import { extractText } from 'unpdf';
for (const f of process.argv.slice(3)) {
  const { totalPages, text } = await extractText(new Uint8Array(readFileSync(f)), { mergePages: false });
  const out = text.map((t, i) => `\n=== PÁGINA ${i + 1} ===\n${t}`).join('');
  const name = f.split(/[\/]/).pop().replace('.pdf', '.txt');
  writeFileSync(process.argv[2] + '/' + name, out);
  console.log(name, totalPages, 'páginas', out.length, 'chars');
}
