// PDF.js configurado para o app: abre documentos e extrai o texto de cada página no navegador.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Fontes padrão, mapas de caracteres e decodificadores que o PDF.js busca quando o arquivo precisa deles.
const ASSETS = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}`;

export const openPdf = (data: Uint8Array) => pdfjs.getDocument({ data, standardFontDataUrl: `${ASSETS}/standard_fonts/`, cMapUrl: `${ASSETS}/cmaps/`, cMapPacked: true, wasmUrl: `${ASSETS}/wasm/` });

// O PDF.js toma posse dos bytes que recebe: trabalha numa cópia, para o chamador continuar usando os seus.
export async function extractPages(bytes: ArrayBuffer): Promise<string[]> {
  const task = openPdf(new Uint8Array(bytes.slice(0)));
  try {
    const doc = await task.promise, pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n), content = await page.getTextContent();
      pages.push(content.items.map((i) => ('str' in i ? i.str + (i.hasEOL ? '\n' : '') : '')).join(''));
      page.cleanup();
    }
    return pages;
  } finally {
    void task.destroy();
  }
}
