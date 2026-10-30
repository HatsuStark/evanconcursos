// Leitor por voz: usa a voz do próprio navegador/sistema (gratuito, nada sai do aparelho).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpeechSection } from '../../../shared/ai/speech.ts';

export const voiceSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

// Preferências por aparelho; o leitor funciona igual se o armazenamento estiver bloqueado.
const stored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* sem armazenamento */ } };

export function useGuideVoice(sections: SpeechSection[]) {
  const [status, setStatus] = useState<'idle' | 'playing' | 'paused'>('idle');
  const [section, setSection] = useState(0);
  const [rate, setRateState] = useState(() => { const r = Number(stored('voice-rate')); return RATES.includes(r) ? r : 1; });
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceUri, setVoiceUri] = useState(() => stored('voice-uri') ?? '');
  const [error, setError] = useState('');
  const pos = useRef({ section: 0, chunk: 0 });
  // Cada início ganha um número: eventos de uma fala cancelada são ignorados.
  const run = useRef(0);
  // O Chrome descarta falas sem referência e para de ler.
  const current = useRef<SpeechSynthesisUtterance | null>(null);
  const prefs = useRef({ rate, voice: undefined as SpeechSynthesisVoice | undefined });
  const voice = voices.find((v) => v.voiceURI === voiceUri) ?? voices.find((v) => /^pt[-_]BR/i.test(v.lang)) ?? voices[0];
  prefs.current = { rate, voice };

  useEffect(() => {
    if (!voiceSupported()) return;
    const load = () => setVoices(window.speechSynthesis.getVoices().filter((v) => /^pt/i.test(v.lang)));
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  const halt = useCallback(() => { run.current++; if (voiceSupported()) window.speechSynthesis.cancel(); }, []);

  const stop = useCallback(() => {
    halt();
    pos.current = { section: 0, chunk: 0 };
    setSection(0); setStatus('idle');
  }, [halt]);

  const play = useCallback(() => {
    halt();
    const mine = run.current;
    setError(''); setStatus('playing');
    const next = () => {
      if (mine !== run.current) return;
      const s = sections[pos.current.section];
      if (!s) { stop(); return; }
      const chunk = s.chunks[pos.current.chunk];
      if (chunk === undefined) {
        pos.current = { section: pos.current.section + 1, chunk: 0 };
        setSection(pos.current.section);
        next();
        return;
      }
      const u = new SpeechSynthesisUtterance(chunk);
      u.lang = 'pt-BR'; u.rate = prefs.current.rate;
      if (prefs.current.voice) u.voice = prefs.current.voice;
      u.onend = () => { if (mine === run.current) { pos.current.chunk++; next(); } };
      u.onerror = (e) => {
        if (mine !== run.current || e.error === 'canceled' || e.error === 'interrupted') return;
        halt(); setStatus('paused');
        setError('A voz deste aparelho parou de responder. Tente de novo ou escolha outra voz.');
      };
      current.current = u;
      window.speechSynthesis.speak(u);
    };
    // Falar logo depois de cancelar faz alguns navegadores ignorarem a fala.
    setTimeout(next, 60);
  }, [sections, halt, stop]);

  // Pausar é cancelar e lembrar o trecho: pause() nativo falha no Android e trava em pausas longas.
  const pause = useCallback(() => { halt(); setStatus('paused'); }, [halt]);

  const jump = useCallback((delta: number) => {
    const to = Math.max(0, Math.min(sections.length - 1, pos.current.section + delta));
    pos.current = { section: to, chunk: 0 };
    setSection(to);
    if (status === 'playing') play();
  }, [sections.length, status, play]);

  // Mudar velocidade ou voz durante a leitura recomeça a frase atual já com o novo ajuste.
  const setRate = useCallback((r: number) => { setRateState(r); store('voice-rate', String(r)); prefs.current.rate = r; if (status === 'playing') play(); }, [status, play]);
  const setVoice = useCallback((uri: string) => {
    setVoiceUri(uri); store('voice-uri', uri);
    prefs.current.voice = voices.find((v) => v.voiceURI === uri);
    if (status === 'playing') play();
  }, [voices, status, play]);

  // Outra apostila ou saída da tela: para de falar (a fala continuaria mesmo com a página trocada).
  useEffect(() => stop, [sections, stop]);
  useEffect(() => {
    window.addEventListener('pagehide', halt);
    return () => window.removeEventListener('pagehide', halt);
  }, [halt]);

  return { status, section, rate, voices, voice, error, play, pause, stop, jump, setRate, setVoice, activeKey: status === 'idle' ? null : sections[section]?.key ?? null };
}
