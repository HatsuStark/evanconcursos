// Texto do roteiro preparado para a voz: artigos, parágrafos, incisos, porcentagens, datas e valores escritos como se
// falam, sem mudar o sentido. Siglas e abreviações comuns vêm do leitor da apostila (spoken). Números simples ficam em
// algarismos: a voz do Gemini os lê bem em português.
import { spoken } from '../ai/speech.ts';

const ORDINAL = ['', 'primeiro', 'segundo', 'terceiro', 'quarto', 'quinto', 'sexto', 'sétimo', 'oitavo', 'nono'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };

export function romanToInt(r: string): number | null {
  if (!/^[IVXLC]+$/.test(r)) return null;
  let total = 0;
  for (let i = 0; i < r.length; i++) {
    const v = ROMAN[r[i]!]!, next = ROMAN[r[i + 1] ?? ''] ?? 0;
    total += v < next ? -v : v;
  }
  return total > 0 && total < 200 ? total : null;
}

// Na leitura de leis: do 1 ao 9, ordinal ("artigo quinto"); do 10 em diante, cardinal ("artigo 10").
const lawNumber = (n: string) => { const v = Number(n); return v >= 1 && v <= 9 ? ORDINAL[v]! : n; };

const RULES: [RegExp, string | ((...m: string[]) => string)][] = [
  // Lei nº 9.784/1999 → Lei 9.784, de 1999
  [/\b(Lei|Decreto|Lei Complementar|LC|Emenda Constitucional|EC)\s*(?:n[º°.o]\s*)?(\d[\d.]*)\s*\/\s*(\d{2,4})\b/g, (_m, k, n, y) => `${k} ${n}, de ${y.length === 2 ? (Number(y) > 30 ? '19' : '20') + y : y}`],
  [/\b(arts?\.?|artigos?)\s*(\d+)\s*[º°o]?(?=[\s,.;:)-]|$)/gi, (_m, k, n) => `${/s\.?$|os$/i.test(k) ? 'artigos' : 'artigo'} ${lawNumber(n)}`],
  [/§\s*único/gi, 'parágrafo único'],
  [/§§\s*/g, 'parágrafos '],
  [/§\s*(\d+)\s*[º°o]?/g, (_m, n) => `parágrafo ${lawNumber(n)}`],
  [/\bpar(?:ágrafo)?\.?\s*único\b/gi, 'parágrafo único'],
  [/\b(incisos?|incs?\.?)\s+([IVXLC]+)\b/g, (_m, k, r) => { const v = romanToInt(r); return `${/s\.?$|os$/i.test(k) ? 'incisos' : 'inciso'} ${v ?? r}`; }],
  [/\b(\d+)\s*[º°]/g, (_m, n) => lawNumber(n)],
  [/\bR\$\s*([\d.]+),00\b/g, (_m, v) => `${v} reais`],
  [/\bR\$\s*([\d.]+),(\d{2})\b/g, (_m, v, c) => `${v} reais e ${Number(c)} centavos`],
  [/\bR\$\s*([\d.]+)\b/g, (_m, v) => `${v} reais`],
  [/(\d+(?:,\d+)?)\s*%/g, (_m, v) => `${v} por cento`],
  [/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (m, d, mo, y) => (Number(mo) >= 1 && Number(mo) <= 12 ? `${Number(d) === 1 ? 'primeiro' : Number(d)} de ${MONTHS[Number(mo) - 1]} de ${y}` : m)],
  [/\bSTF\b/g, 'STF'], [/\bSTJ\b/g, 'STJ'],
  [/\bc\.?\s*c\.?\b(?=\s*(art|o|a)\b)/gi, 'combinado com'],
  [/\bex\.:\s*/gi, 'por exemplo, '], [/\bobs\.:\s*/gi, 'observação: '], [/\bi\.e\.,?\s*/gi, 'isto é, '], [/\bp\.\s*ex\.,?\s*/gi, 'por exemplo, '],
  [/\s*→\s*/g, ': '], [/\s*\/\s*(?=[a-záéíóú])/gi, ' ou '],
];

export function speakable(t: string): string {
  let s = t.replace(/[*_#`|]+/g, ' ');
  for (const [re, to] of RULES) s = s.replace(re, to as never);
  return spoken(s).replace(/\s+([,.;:?!])/g, '$1').trim();
}
