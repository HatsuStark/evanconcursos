// Dicionário de termos: glossário próprio (carregado só quando o balão abre), IA para o que falta e termos recentes.
import type { GlossaryEntry } from '../../../shared/glossary/search.ts';
import { supabase } from './supabase.ts';

export const loadGlossary = () => import('../../../shared/glossary/terms.ts').then((m) => m.GLOSSARY);

export async function askGlossaryAi(term: string): Promise<GlossaryEntry | null> {
  const { data, error } = await supabase.functions.invoke('glossary', { body: { term } });
  if (error) {
    let msg = error.message;
    try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* sem JSON */ }
    throw new Error(msg);
  }
  return (data as { entry: GlossaryEntry | null }).entry;
}

// Abre o dicionário já com um termo (seleção de texto, leitor de PDF).
export const DICT_EVENT = 'dict:lookup';
export const lookupInDictionary = (term: string) => window.dispatchEvent(new CustomEvent(DICT_EVENT, { detail: term }));

const RECENT_KEY = 'dict-recent', MAX_RECENT = 6;
export function readRecent(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((s) => typeof s === 'string').slice(0, MAX_RECENT) : []; } catch { return []; }
}
export function pushRecent(term: string): string[] {
  const next = [term, ...readRecent().filter((t) => t.toLowerCase() !== term.toLowerCase())].slice(0, MAX_RECENT);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* armazenamento bloqueado */ }
  return next;
}

// Lugar do botão escolhido pelo estudante: borda e altura (fração da tela). Padrão: esquerda, no meio.
export interface DictPos { side: 'left' | 'right'; y: number }
const POS_KEY = 'dict-pos';
export function readDictPos(): DictPos {
  try {
    const v = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null');
    if (v && (v.side === 'left' || v.side === 'right') && typeof v.y === 'number' && v.y > 0 && v.y < 1) return { side: v.side, y: v.y };
  } catch { /* armazenamento bloqueado ou valor inválido */ }
  return { side: 'left', y: 0.5 };
}
export function saveDictPos(p: DictPos) {
  try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* armazenamento bloqueado */ }
}
