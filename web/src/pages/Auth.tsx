import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase.ts';

export function AuthPage() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const { data, error } = mode === 'in'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) setMsg({ text: error.message, error: true });
    else if (mode === 'up' && !data.session) setMsg({ text: 'Conta criada. Confirme pelo link enviado ao seu e-mail e depois entre.', error: false });
  }

  return (
    <div className="center-page">
      <form className="glass auth-card" onSubmit={submit}>
        <div className="logo" aria-hidden style={{ margin: 0 }}>E</div>
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: 28 }}>Evan Concursos</h1>
          <p className="muted" style={{ margin: 0 }}>Envie o edital e receba um plano de estudos feito para você.</p>
        </div>
        <label className="field">E-mail
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">Senha
          <input className="input" type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {msg && <p className={msg.error ? 'error' : 'muted'} role="status" style={{ margin: 0 }}>{msg.text}</p>}
        <button className="btn" disabled={busy}>{busy ? 'Aguarde…' : mode === 'in' ? 'Entrar' : 'Criar conta'}</button>
        <button type="button" className="btn ghost" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg(null); }}>
          {mode === 'in' ? 'Ainda não tenho conta' : 'Já tenho conta'}
        </button>
      </form>
    </div>
  );
}
