import { Pause, Play, SkipBack, SkipForward, Square } from 'lucide-react';
import type { SpeechSection } from '../../../shared/ai/speech.ts';
import { localVoiceSupported } from '../lib/piper.ts';
import { BROWSER_DEFAULT, CADU, RATES, voiceSupported, type useGuideVoice } from '../lib/voice.ts';

// Barra do leitor por voz (apostila e lei seca): fica presa no rodapé enquanto há leitura.
// unit: o que cada seção é ("seção", "artigo"), para os rótulos de pular.
export function VoiceBar({ voice, speech, unit = 'seção' }: { voice: ReturnType<typeof useGuideVoice>; speech: SpeechSection[]; unit?: string }) {
  if (voice.status === 'idle') return null;
  const prev = `${unit === 'artigo' ? 'Artigo anterior' : 'Seção anterior'}`, next = `${unit === 'artigo' ? 'Próximo artigo' : 'Próxima seção'}`;
  return (
    <div className="glass voice-bar no-print" role="group" aria-label="Leitor por voz">
      <button className="icon-btn" aria-label={prev} title={prev} disabled={voice.section === 0} onClick={() => voice.jump(-1)}><SkipBack size={16} /></button>
      {voice.status === 'playing'
        ? <button className="btn sm" onClick={voice.pause}><Pause size={15} /> Pausar</button>
        : <button className="btn sm" onClick={voice.play}><Play size={15} /> Continuar</button>}
      <button className="icon-btn" aria-label={next} title={next} disabled={voice.section >= speech.length - 1} onClick={() => voice.jump(1)}><SkipForward size={16} /></button>
      <button className="icon-btn" aria-label="Parar" title="Parar" onClick={voice.stop}><Square size={15} /></button>
      <span className="voice-title small">{speech[voice.section]?.title}</span>
      <select className="select voice-select" aria-label="Velocidade" value={voice.rate} onChange={(e) => voice.setRate(Number(e.target.value))}>
        {RATES.map((r) => <option key={r} value={r}>{String(r).replace('.', ',')}x</option>)}
      </select>
      <select className="select voice-select" aria-label="Voz" value={voice.value} onChange={(e) => voice.setVoice(e.target.value)}>
        {localVoiceSupported() && <option value={CADU}>Cadu</option>}
        {voiceSupported() && (
          <optgroup label="Voz do navegador">
            {voice.voices.length ? voice.voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>) : <option value={BROWSER_DEFAULT}>Padrão do navegador</option>}
          </optgroup>
        )}
      </select>
      {voice.loading && (
        <span className="faint small" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <span className="spinner" /> {voice.download != null ? `Baixando a voz, só na primeira vez (63 MB): ${Math.round(voice.download * 100)}%` : 'Preparando o áudio…'}
        </span>
      )}
      {!voice.isCadu && voiceSupported() && !voice.voices.length && <span className="faint small">Sem voz em português no navegador: a pronúncia pode sair errada.</span>}
      {voice.error && <span className="error small">{voice.error}</span>}
    </div>
  );
}
