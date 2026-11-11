// Pomodoro sobre o cronômetro da sessão: o tempo de foco anda junto com o cronômetro (pausar o estudo congela o foco).
// Fim do foco pausa o cronômetro e começa a pausa (que não conta como estudo); a cada `every` focos, pausa longa.
// Fim da pausa avisa e espera o estudante continuar. Liga/desliga e preset ficam no navegador.
import { useEffect, useRef, useState } from 'react';

export const PRESETS = {
  '25/5': { focus: 25, short: 5, long: 15, every: 4 },
  '50/10': { focus: 50, short: 10, long: 20, every: 3 },
} as const;
export type Preset = keyof typeof PRESETS;
export type Phase = 'foco' | 'pausa';

const KEY = 'pomodoro';
function load(): { enabled: boolean; preset: Preset } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { enabled: !!v.enabled, preset: v.preset in PRESETS ? v.preset : '25/5' };
  } catch { return { enabled: false, preset: '25/5' }; }
}
function save(v: { enabled: boolean; preset: Preset }) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* sem armazenamento */ } }

// Áudio do bipe: um só contexto, criado num toque do estudante. O Safari (iPhone) deixa mudo o contexto criado fora de
// um toque, como o do fim do foco, que vem do cronômetro.
let audioCtx: AudioContext | null = null;
function primeAudio() {
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
  } catch { /* sem áudio */ }
}

// Aviso: bipe curto (Web Audio) e notificação do navegador, se permitida.
function alarm(title: string, body: string) {
  try {
    primeAudio();
    const ctx = audioCtx!;
    [0, 0.25, 0.5].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; g.gain.setValueAtTime(0.2, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
    });
  } catch { /* sem áudio */ }
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, icon: '/icon-192.png' }); } catch { /* sem notificação */ }
}

export function usePomodoro(timer: { running: boolean; seconds: number; pause: () => void }) {
  const [cfg, setCfg] = useState(load);
  const p = PRESETS[cfg.preset];
  const [phase, setPhase] = useState<Phase>('foco');
  const [left, setLeft] = useState<number>(p.focus * 60);
  const [cycles, setCycles] = useState(0);
  const prev = useRef(timer.seconds);
  const pauseRef = useRef(timer.pause);
  pauseRef.current = timer.pause;

  // Com o pomodoro ligado, o primeiro toque na página libera o bipe (iPhone).
  useEffect(() => {
    if (!cfg.enabled) return;
    window.addEventListener('pointerdown', primeAudio, { once: true });
    return () => window.removeEventListener('pointerdown', primeAudio);
  }, [cfg.enabled]);

  // Foco: cada segundo a mais no cronômetro desconta do foco; depois da tela bloqueada, vários de uma vez. Zerar o
  // cronômetro (salto para trás) não conta.
  useEffect(() => {
    const step = timer.seconds - prev.current;
    prev.current = timer.seconds;
    if (!cfg.enabled || phase !== 'foco' || !timer.running || step < 1) return;
    if (left > step) { setLeft(left - step); return; }
    const done = cycles + 1, long = done % p.every === 0;
    pauseRef.current();
    setCycles(done); setPhase('pausa'); setLeft((long ? p.long : p.short) * 60);
    alarm('Hora da pausa', `${done} ${done === 1 ? 'foco concluído' : 'focos concluídos'}. Pausa de ${long ? p.long : p.short} min.`);
  }, [timer.seconds]);

  // Pausa: corre sozinha, pelo relógio (com a tela bloqueada os tiques param). Voltar a estudar encerra a pausa.
  useEffect(() => {
    if (!cfg.enabled || phase !== 'pausa' || timer.running) return;
    let last = Date.now();
    const t = setInterval(() => {
      const step = Math.floor((Date.now() - last) / 1000);
      if (step < 1) return;
      last += step * 1000;
      setLeft((l) => Math.max(0, l - step));
    }, 1000);
    return () => clearInterval(t);
  }, [cfg.enabled, phase, timer.running]);
  useEffect(() => {
    if (!cfg.enabled || phase !== 'pausa') return;
    if (timer.running) { setPhase('foco'); setLeft(p.focus * 60); return; }
    if (left > 0) return;
    setPhase('foco'); setLeft(p.focus * 60);
    alarm('Pausa encerrada', 'Hora de voltar ao foco.');
  }, [cfg.enabled, phase, timer.running, left, p.focus]);

  const update = (next: { enabled: boolean; preset: Preset }) => {
    setCfg(next); save(next);
    setPhase('foco'); setLeft(PRESETS[next.preset].focus * 60); setCycles(0);
  };
  return {
    enabled: cfg.enabled, preset: cfg.preset, phase, left, cycles,
    toggle: () => {
      if (!cfg.enabled) primeAudio();
      if (!cfg.enabled && 'Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
      update({ ...cfg, enabled: !cfg.enabled });
    },
    setPreset: (preset: Preset) => update({ ...cfg, preset }),
    skipBreak: () => { setPhase('foco'); setLeft(p.focus * 60); },
  };
}
