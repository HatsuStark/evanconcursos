import { BarChart3, Inbox, LogOut } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useFeedbackList } from '../lib/feedback.ts';
import { Shell } from '../components/Shell.tsx';
import { useAppearance, type ThemeChoice } from '../lib/appearance.ts';
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

const THEMES: { key: ThemeChoice; label: string }[] = [{ key: 'system', label: 'Sistema' }, { key: 'light', label: 'Claro' }, { key: 'dark', label: 'Escuro' }];

// Aparência deste aparelho: tema e ajustes de acessibilidade para leitura longa.
function AppearanceForm() {
  const [a, set] = useAppearance();
  return (
    <section className="glass card" style={{ display: 'grid', gap: 14 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Aparência</h2>
      <div style={{ display: 'grid', gap: 8 }}>
        <span className="muted small" id="theme-label">Tema</span>
        <div className="segmented" role="group" aria-labelledby="theme-label">
          {THEMES.map((t) => <button key={t.key} type="button" className={a.theme === t.key ? 'on' : ''} aria-pressed={a.theme === t.key} onClick={() => set({ theme: t.key })}>{t.label}</button>)}
        </div>
        <p className="muted small" style={{ margin: 0 }}>Escolha o que for mais confortável para ler. Sistema acompanha o modo claro ou escuro do aparelho.</p>
      </div>
      <label className="check" style={{ alignItems: 'flex-start' }}>
        <input type="checkbox" checked={a.strong} onChange={(e) => set({ strong: e.target.checked })} style={{ marginTop: 4 }} />
        <span><strong style={{ color: 'var(--text)' }}>Leitura reforçada</strong><br />Letra maior nas apostilas, questões e lei seca, texto mais grosso, bordas firmes e mais contraste.</span>
      </label>
      <label className="check" style={{ alignItems: 'flex-start' }}>
        <input type="checkbox" checked={a.paper} onChange={(e) => set({ paper: e.target.checked })} style={{ marginTop: 4 }} />
        <span><strong style={{ color: 'var(--text)' }}>Fundo de papel na leitura</strong><br />Apostila, lei seca, questões e flashcards em tom de papel, com menos brilho em sessões longas.</span>
      </label>
      <p className="faint small" style={{ margin: 0 }}>Vale para este aparelho.</p>
    </section>
  );
}

export function AccountPage() {
  const { session } = useAuth();
  const [saved, setSaved] = useState(false);
  // Só admin consegue listar: para os demais a consulta falha (403) e o atalho não aparece.
  const feedback = useFeedbackList();
  const newCount = feedback.data?.filter((f) => f.status === 'novo').length ?? 0;
  return (
    <Shell title="Conta" subtitle={session?.user.email}>
      <div className="grid" style={{ gap: 14, maxWidth: 460 }}>
        <AppearanceForm />
        <section className="glass card" style={{ display: 'grid', gap: 14 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Alterar senha</h2>
          <PasswordForm submitLabel="Salvar senha" onDone={() => setSaved(true)} />
          {saved && <p className="muted" role="status" style={{ margin: 0 }}>Senha alterada.</p>}
        </section>
        {feedback.data && (
          <>
            <Link className="btn ghost" to="/admin"><BarChart3 size={16} /> Painel do admin</Link>
            <Link className="btn ghost" to="/relatos"><Inbox size={16} /> Relatos de usuários{newCount ? ` (${newCount} novos)` : ''}</Link>
          </>
        )}
        <button className="btn ghost" onClick={() => supabase.auth.signOut()}><LogOut size={16} /> Sair</button>
      </div>
    </Shell>
  );
}
