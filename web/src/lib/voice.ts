// Leitor por voz da apostila: voz Faber (Piper, gerada no aparelho) ou voz do navegador. Ambas sem custo por uso.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { speechParts, type SpeechSection } from '../../../shared/ai/speech.ts';
import { clearLocalAudio, localPartUrl, localVoiceSupported } from './piper.ts';

export const voiceSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
export const FABER = 'faber', BROWSER_DEFAULT = 'navegador';

// Preferências por aparelho; o leitor funciona igual se o armazenamento estiver bloqueado.
const stored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* sem armazenamento */ } };

// Sem escolha salva (ou com uma voz de IA antiga), usa a Faber quando o aparelho aceita.
const isFaber = (choice: string) => localVoiceSupported() && (!choice || choice === FABER || choice.startsWith('ai:'));

export function useGuideVoice(sections: SpeechSection[]) {
  const [status, setStatus] = useState<'idle' | 'playing' | 'paused'>('idle');
  const [loading, setLoading] = useState(false);
  const [download, setDownload] = useState<number | null>(null);
  const [section, setSection] = useState(0);
  const [rate, setRateState] = useState(() => { const r = Number(stored('voice-rate')); return RATES.includes(r) ? r : 1; });
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  // Voz escolhida: FABER, BROWSER_DEFAULT ou o identificador de uma voz do navegador.
  const [choice, setChoice] = useState(() => stored('voice-uri') ?? '');
  const [error, setError] = useState('');
  const faber = isFaber(choice);
  const browserVoice = voices.find((v) => v.voiceURI === choice) ?? voices.find((v) => /^pt[-_]BR/i.test(v.lang)) ?? voices[0];
  const parts = useMemo(() => sections.map(speechParts), [sections]);
  const pos = useRef({ section: 0, chunk: 0 });
  // Cada início ganha um número: eventos de uma fala cancelada são ignorados.
  const run = useRef(0);
  // O Chrome descarta falas sem referência e para de ler.
  const current = useRef<SpeechSynthesisUtterance | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const loaded = useRef('');   // trecho carregado no <audio>: continuar da pausa sem gerar de novo
  const prefs = useRef({ rate, faber, browserVoice });
  prefs.current = { rate, faber, browserVoice };

  useEffect(() => {
    if (!voiceSupported()) return;
    const load = () => setVoices(window.speechSynthesis.getVoices().filter((v) => /^pt/i.test(v.lang)));
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  const halt = useCallback(() => {
    run.current++;
    if (voiceSupported()) window.speechSynthesis.cancel();
    audio.current?.pause();
  }, []);

  const unload = useCallback(() => {
    loaded.current = '';
    if (audio.current) { audio.current.removeAttribute('src'); audio.current.load(); }
  }, []);

  const stop = useCallback(() => {
    halt(); unload(); clearLocalAudio();
    pos.current = { section: 0, chunk: 0 };
    setSection(0); setStatus('idle'); setLoading(false); setDownload(null);
  }, [halt, unload]);

  const fail = useCallback((message: string) => { halt(); setLoading(false); setDownload(null); setStatus('paused'); setError(message); }, [halt]);

  // Avança de seção quando os trechos acabam; devolve false no fim da apostila.
  const nextSection = useCallback((count: (i: number) => number) => {
    while (pos.current.section < sections.length && pos.current.chunk >= count(pos.current.section)) {
      pos.current = { section: pos.current.section + 1, chunk: 0 };
    }
    setSection(Math.min(pos.current.section, sections.length - 1));
    return pos.current.section < sections.length;
  }, [sections.length]);

  const playBrowser = useCallback((mine: number) => {
    const next = () => {
      if (mine !== run.current) return;
      if (!nextSection((i) => sections[i]!.chunks.length)) { stop(); return; }
      const u = new SpeechSynthesisUtterance(sections[pos.current.section]!.chunks[pos.current.chunk]!);
      u.lang = 'pt-BR'; u.rate = prefs.current.rate;
      if (prefs.current.browserVoice) u.voice = prefs.current.browserVoice;
      u.onend = () => { if (mine === run.current) { pos.current.chunk++; next(); } };
      u.onerror = (e) => {
        if (mine !== run.current || e.error === 'canceled' || e.error === 'interrupted') return;
        fail('A voz deste aparelho parou de responder. Tente de novo ou escolha outra voz.');
      };
      current.current = u;
      window.speechSynthesis.speak(u);
    };
    // Falar logo depois de cancelar faz alguns navegadores ignorarem a fala.
    setTimeout(next, 60);
  }, [sections, nextSection, stop, fail]);

  const playFaber = useCallback(async (mine: number) => {
    const el = (audio.current ??= new Audio());
    const urlOf = (s: number, p: number) => localPartUrl(parts[s]![p]!, (f) => setDownload(f < 1 ? f : null));
    while (mine === run.current) {
      if (!nextSection((i) => parts[i]!.length)) { stop(); return; }
      const { section: s, chunk: p } = pos.current;
      const here = `${s}|${p}`;
      if (loaded.current !== here) {
        setLoading(true);
        let url: string;
        try { url = await urlOf(s, p); }
        catch (e) { if (mine === run.current) fail(`Não foi possível gerar a voz: ${(e as Error).message}. Tente de novo ou use a voz do navegador.`); return; }
        if (mine !== run.current) return;
        el.src = url;
        loaded.current = here;
      }
      el.playbackRate = prefs.current.rate;
      try { await el.play(); }
      catch { if (mine === run.current) fail('O navegador bloqueou o áudio. Toque em Continuar.'); return; }
      if (mine !== run.current) return;
      setLoading(false); setDownload(null);
      // Adianta o próximo trecho para não haver pausa entre eles; a falha aparece só se ele for mesmo tocado.
      if (p + 1 < parts[s]!.length) urlOf(s, p + 1).catch(() => {});
      else if (s + 1 < sections.length) urlOf(s + 1, 0).catch(() => {});
      const finished = await new Promise<boolean>((resolve) => {
        const done = (ok: boolean) => { el.onended = null; el.onerror = null; el.onpause = null; resolve(ok); };
        el.onended = () => done(true);
        el.onerror = () => done(false);
        // Pausar encerra esta espera; o próximo "Continuar" retoma do mesmo ponto.
        el.onpause = () => { if (mine !== run.current) done(true); };
      });
      if (mine !== run.current) return;
      if (!finished) { unload(); fail('Não foi possível tocar este trecho. Toque em Continuar para tentar de novo.'); return; }
      loaded.current = '';
      pos.current.chunk++;
    }
  }, [sections.length, parts, nextSection, stop, fail, unload]);

  const play = useCallback(() => {
    halt();
    const mine = run.current;
    setError(''); setStatus('playing');
    if (prefs.current.faber) void playFaber(mine);
    else if (voiceSupported()) playBrowser(mine);
    else fail('Este navegador não tem voz disponível.');
  }, [halt, playFaber, playBrowser, fail]);

  // Na voz do navegador, pausar é cancelar e lembrar o trecho: pause() nativo falha no Android e trava em pausas longas.
  const pause = useCallback(() => { halt(); setLoading(false); setStatus('paused'); }, [halt]);

  const jump = useCallback((delta: number) => {
    const to = Math.max(0, Math.min(sections.length - 1, pos.current.section + delta));
    halt(); unload();
    pos.current = { section: to, chunk: 0 };
    setSection(to); setLoading(false);
    if (status === 'playing') play();
  }, [sections.length, status, play, halt, unload]);

  // Mudar a velocidade: no áudio vale na hora; na voz do navegador, recomeça a frase atual.
  const setRate = useCallback((r: number) => {
    setRateState(r); store('voice-rate', String(r)); prefs.current.rate = r;
    if (audio.current) audio.current.playbackRate = r;
    if (status === 'playing' && !prefs.current.faber) play();
  }, [status, play]);

  // Trocar de voz recomeça a seção atual: cada tipo divide o texto em trechos de tamanhos diferentes.
  const setVoice = useCallback((value: string) => {
    setChoice(value); store('voice-uri', value);
    prefs.current.faber = isFaber(value);
    prefs.current.browserVoice = voices.find((v) => v.voiceURI === value) ?? voices.find((v) => /^pt[-_]BR/i.test(v.lang)) ?? voices[0];
    halt(); unload();
    pos.current.chunk = 0;
    if (status === 'playing') play();
  }, [voices, status, play, halt, unload]);

  // Outra apostila ou saída da tela: para de falar (a fala continuaria mesmo com a página trocada).
  useEffect(() => stop, [sections, stop]);
  useEffect(() => {
    window.addEventListener('pagehide', halt);
    return () => window.removeEventListener('pagehide', halt);
  }, [halt]);

  return {
    status, loading, download, section, rate, voices, error, play, pause, stop, jump, setRate, setVoice,
    value: faber ? FABER : browserVoice?.voiceURI ?? BROWSER_DEFAULT,
    isFaber: faber,
    activeKey: status === 'idle' ? null : sections[section]?.key ?? null,
  };
}
