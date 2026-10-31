import { LogOut } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Shell } from '../components/Shell.tsx';
import { useAuth } from '../lib/auth.tsx';
import { supabase } from '../lib/supabase.ts';

const MIN_PASSWORD = 8; // igual ao mínimo configurado no Supabase

function PasswordForm({ submitLabel, onDone }: { submitLabel: string; onDone?: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError('As senhas não são iguais.'); return; }
    setBusy(true); setError('');
    const { error } = await supabase.auth.updateUser({ password, data: { must_change_password: false } });
    setBusy(false);
    if (error) { setError(/different from the old/i.test(error.message) ? 'A nova senha precisa ser diferente da atual.' : error.message); return; }
    setPassword(''); setConfirm('');
    onDone?.();
  }

  return (
    <form style={{ display: 'grid', gap: 14 }} onSubmit={submit}>
      <label className="field">Nova senha
        <input className="input" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} required value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label className="field">Repita a nova senha
        <input className="input" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
      <button className="btn" disabled={busy}>{busy ? 'Aguarde…' : submitLabel}</button>
    </form>
  );
}

// Primeiro acesso com a senha temporária do convite: nada mais abre antes de trocar.
export function FirstPasswordPage() {
  return (
    <div className="center-page">
      <div className="glass auth-card">
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: 24 }}>Crie sua senha</h1>
          <p className="muted" style={{ margin: 0 }}>A senha que você recebeu é temporária. Escolha uma só sua, com pelo menos {MIN_PASSWORD} caracteres.</p>
        </div>
        <PasswordForm submitLabel="Salvar e entrar" />
        <button className="btn ghost" onClick={() => supabase.auth.signOut()}>Sair</button>
      </div>
    </div>
  );
}

export function AccountPage() {
  const { session } = useAuth();
  const [saved, setSaved] = useState(false);
  return (
    <Shell title="Conta" subtitle={session?.user.email}>
      <div className="grid" style={{ gap: 14, maxWidth: 460 }}>
        <section className="glass card" style={{ display: 'grid', gap: 14 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Alterar senha</h2>
          <PasswordForm submitLabel="Salvar senha" onDone={() => setSaved(true)} />
          {saved && <p className="muted" role="status" style={{ margin: 0 }}>Senha alterada.</p>}
        </section>
        <button className="btn ghost" onClick={() => supabase.auth.signOut()}><LogOut size={16} /> Sair</button>
      </div>
    </Shell>
  );
}
