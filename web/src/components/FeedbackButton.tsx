import { Bug, Lightbulb, MessageCircle, MessageSquareText, Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { sendFeedback } from '../lib/feedback.ts';

const KINDS = [
  { key: 'bug', label: 'Bug', icon: Bug },
  { key: 'sugestao', label: 'Sugestão', icon: Lightbulb },
  { key: 'outro', label: 'Outro', icon: MessageSquareText },
] as const;
type Kind = (typeof KINDS)[number]['key'];

// Balão flutuante para relatar bug ou sugerir melhoria. Vai para a Edge Function "feedback" (banco + e-mail),
// com a página atual e o navegador para ajudar a reproduzir.
export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>('bug');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown); };
  }, [open]);

  async function send() {
    setStatus('sending'); setError('');
    try { await sendFeedback(kind, message); }
    catch (e) { setError((e as Error).message || 'Não foi possível enviar agora.'); setStatus('error'); return; }
    setStatus('sent'); setMessage('');
    setTimeout(() => { setOpen(false); setStatus('idle'); }, 1800);
  }

  return (
    <div className="feedback" ref={box}>
      {open && (
        <div className="glass feedback-panel" role="dialog" aria-label="Relatar bug ou sugestão">
          <div className="feedback-head">
            <strong>Fale com a gente</strong>
            <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => setOpen(false)} aria-label="Fechar"><X size={16} /></button>
          </div>
          {status === 'sent' ? <p className="small" style={{ color: 'var(--lime)' }}>Recebido, obrigado!</p> : (
            <>
              <div className="feedback-kinds">
                {KINDS.map((k) => (
                  <button key={k.key} className={'btn sm' + (kind === k.key ? '' : ' ghost')} onClick={() => setKind(k.key)}><k.icon size={14} /> {k.label}</button>
                ))}
              </div>
              <textarea className="textarea" autoFocus maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)}
                placeholder={kind === 'bug' ? 'O que aconteceu? O que você esperava?' : kind === 'sugestao' ? 'Qual ideia ou melhoria você sugere?' : 'Escreva sua mensagem'} />
              {status === 'error' && <p className="error" style={{ margin: 0 }}>{error}</p>}
              <button className="btn" disabled={message.trim().length < 3 || status === 'sending'} onClick={send}><Send size={16} /> {status === 'sending' ? 'Enviando…' : 'Enviar'}</button>
              <span className="faint small">A página atual e o navegador vão junto para ajudar a reproduzir.</span>
            </>
          )}
        </div>
      )}
      <button className="feedback-fab" onClick={() => setOpen(!open)} title="Relatar bug ou sugestão" aria-label="Relatar bug ou sugestão" aria-expanded={open}>
        <MessageCircle size={22} />
      </button>
    </div>
  );
}
