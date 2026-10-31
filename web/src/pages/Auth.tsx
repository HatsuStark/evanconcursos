import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase.ts';

const authMessage = (m: string) => (/invalid login/i.test(m) ? 'E-mail ou senha incorretos.' : /banned/i.test(m) ? 'Este acesso foi encerrado.' : m);

// Entrada só por convite: as contas são criadas com scripts/users.mjs e o cadastro público fica desligado.
export function AuthPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError(authMessage(error.message));
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
          <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
        <button className="btn" disabled={busy}>{busy ? 'Aguarde…' : 'Entrar'}</button>
        <p className="faint small" style={{ margin: 0, textAlign: 'center' }}>Acesso por convite. Esqueceu a senha? Fale com quem convidou você.</p>
      </form>
    </div>
  );
}
