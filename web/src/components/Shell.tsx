import { CalendarDays, ClipboardList, FileText, LayoutDashboard, Library, ListChecks, PenLine, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';

const NAV = [
  { to: '/', label: 'Hoje', icon: LayoutDashboard, end: true },
  { to: '/cronograma', label: 'Cronograma', icon: CalendarDays },
  { to: '/edital', label: 'Edital', icon: ClipboardList },
  { to: '/questoes', label: 'Questões', icon: ListChecks },
  { to: '/materiais', label: 'Meus materiais', icon: Library },
  { to: '/discursivas', label: 'Discursivas', icon: PenLine },
  { to: '/concursos', label: 'Concursos', icon: FileText },
];

// Layout do app: barra lateral de ícones, conteúdo e painel direito (contexto secundário).
// focus: modo foco do estudo, só o conteúdo e as ações (sem título, barra lateral nem painel direito).
export function Shell({ title, subtitle, actions, rail, focus, children }: {
  title: string; subtitle?: string; actions?: ReactNode; rail?: ReactNode; focus?: boolean; children: ReactNode;
}) {
  return (
    <div className={'app' + (rail ? '' : ' no-rail') + (focus ? ' focus' : '')}>
      <nav className="sidebar" aria-label="Navegação principal">
        <div className="logo" aria-hidden>E</div>
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')} title={label} aria-label={label}>
            <Icon size={22} />
          </NavLink>
        ))}
        <div className="nav-spacer" />
        <NavLink to="/conta" className={({ isActive }) => 'nav-item secondary-nav' + (isActive ? ' active' : '')} title="Conta" aria-label="Conta">
          <UserRound size={20} />
        </NavLink>
      </nav>
      <main className="main">
        {!focus && <Link to="/conta" className="account-link" title="Conta" aria-label="Conta"><UserRound size={18} /></Link>}
        <header className="page-head">
          {!focus && (
            <div>
              <h1>{title}</h1>
              {subtitle && <p>{subtitle}</p>}
            </div>
          )}
          {actions}
        </header>
        {children}
      </main>
      {rail && <aside className="rail">{rail}</aside>}
    </div>
  );
}
