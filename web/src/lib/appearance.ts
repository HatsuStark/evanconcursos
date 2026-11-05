// Aparência: tema (sistema, claro ou escuro), leitura reforçada e fundo de papel nas áreas de leitura. Fica salva neste
// aparelho. O tema vai resolvido para <html data-theme>, para o CSS não depender de media query; o index.html aplica a
// escolha antes de o app carregar, sem piscar o tema errado.
import { useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
export interface Appearance { theme: ThemeChoice; strong: boolean; paper: boolean }

const KEY = 'evan-appearance';
const DEFAULT: Appearance = { theme: 'system', strong: false, paper: false };
const BAR = { light: '#eef1f6', dark: '#1a1e2c' }; // cor da barra do navegador, igual ao fundo

export function loadAppearance(): Appearance {
  try { return { ...DEFAULT, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Appearance>) }; }
  catch { return DEFAULT; }
}

const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
export const resolveTheme = (a: Appearance) => (a.theme === 'system' ? (systemDark() ? 'dark' : 'light') : a.theme);

export function applyAppearance(a: Appearance) {
  const root = document.documentElement, theme = resolveTheme(a);
  root.dataset.theme = theme;
  if (a.strong) root.dataset.reading = 'strong'; else delete root.dataset.reading;
  if (a.paper) root.dataset.paper = 'on'; else delete root.dataset.paper;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[theme]);
}

// Acompanha a troca de claro/escuro do sistema enquanto a escolha for "Sistema".
export function watchSystemTheme() {
  if (typeof matchMedia !== 'function') return;
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { const a = loadAppearance(); if (a.theme === 'system') applyAppearance(a); });
}

export function useAppearance() {
  const [value, setValue] = useState(loadAppearance);
  useEffect(() => {
    applyAppearance(value);
    try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* sem armazenamento: vale só nesta visita */ }
  }, [value]);
  return [value, (patch: Partial<Appearance>) => setValue((v) => ({ ...v, ...patch }))] as const;
}
