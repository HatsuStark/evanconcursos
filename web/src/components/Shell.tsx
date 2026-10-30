import { BarChart3, CalendarDays, FileText, LayoutDashboard, LogOut, PenLine } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { supabase } from '../lib/supabase.ts';

const NAV = [
  { to: '/', label: 'Hoje', icon: LayoutDashboard, end: true },
  { to: '/cronograma', label: 'Cronograma', icon: CalendarDays },
  { to: '/desempenho', label: 'Desempenho', icon: BarChart3 },
  { to: '/discursivas', label: 'Discursivas', icon: PenLine },
  { to: '/concursos', label: 'Concursos', icon: FileText },
];

// Layout do app: barra lateral de ícones, conteúdo e painel direito (contexto secundário).
export function Shell({ title, subtitle, actions, rail, children }: {
  title: string; subtitle?: string; actions?: ReactNode; rail?: ReactNode; children: ReactNode;
}) {
  return (
    <div className={'app' + (rail ? '' : ' no-rail')}>
      <nav className="sidebar" aria-label="Navegação principal">
        <div className="logo" aria-hidden>E</div>
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')} title={label} aria-label={label}>
            <Icon size={22} />
          </NavLink>
        ))}
        <div className="nav-spacer" />
        <button className="nav-item secondary-nav" style={{ border: 0, background: 'none', cursor: 'pointer' }} title="Sair" aria-label="Sair"
          onClick={() => supabase.auth.signOut()}>
          <LogOut size={20} />
        </button>
      </nav>
      <main className="main">
        <header className="page-head">
          <div>
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions}
        </header>
        {children}
      </main>
      {rail && <aside className="rail">{rail}</aside>}
    </div>
  );
}
