// Destaque no enunciado das questões criadas pela IA. A resposta da IA é texto puro, então o trecho que o comando chama de
// "destacado" vem marcado com **duplo asterisco** e vira negrito na tela.

export const MARK_RULE = 'Quando o comando se referir a palavra, expressão ou trecho "destacado", "em destaque", "sublinhado" ou "em negrito", marque esse trecho no próprio enunciado com **duplo asterisco** (ex.: "mantinha uma postura **beligerante** diante da ordem"). Não use asteriscos para mais nada.';

const MARK = /\*\*([^*\n]+?)\*\*/g;
const REFERS = /destacad|em destaque|sublinhad|em negrito|grifad/i;

// O comando fala em termo destacado, mas nada foi marcado (nem com a marca, nem em HTML): a questão não tem como ser
// respondida. Vale para o texto da IA e para o HTML já gravado.
export const missingMark = (text: string) => REFERS.test(text) && !new RegExp(MARK.source).test(text) && !/<(b|strong|u|em|i)\b[^>]*>/i.test(text);

// Trechos em sequência, com o que vai em negrito (para montar a tela sem HTML).
export function splitMarks(text: string): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(MARK)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index), bold: false });
    out.push({ text: m[1]!, bold: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false });
  return out;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Para o formato das questões do banco, que é HTML: o texto é escapado e só a marca vira <b>.
export const marksToHtml = (text: string) => escapeHtml(text).replace(MARK, '<b>$1</b>');
