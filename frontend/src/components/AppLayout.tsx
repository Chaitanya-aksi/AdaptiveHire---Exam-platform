import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';
import { homeFor } from './ProtectedRoute';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

/*
 * Sections, not pages.
 *
 * "Question performance" used to sit here beside "Question bank" as though the
 * two were different parts of the product rather than two views of the same
 * one, and the bar grew a link every time anything was added. A section with
 * more than one page now carries its own `SubNav`; this list stays short enough
 * to read.
 *
 * "My account" is not here either — it is a tab inside Settings, and still
 * reachable from the user menu, which is where people look for it first.
 */
const RECRUITER_NAV: NavItem[] = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/assessments', label: 'Assessments' },
  { to: '/admin/questions', label: 'Question bank' },
  { to: '/admin/modules', label: 'Modules' },
  { to: '/admin/people', label: 'People' },
  { to: '/admin/settings', label: 'Settings' },
];

/**
 * The recruiter shell. Candidates have their own — `CandidateLayout` — because
 * two destinations do not fill a bar built for six, so the nav is unconditional
 * here rather than branching on the role.
 */
export function AppLayout() {
  const { user } = useAuth();
  const items = RECRUITER_NAV;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to={user ? homeFor(user.role) : '/'} className="brand">
            <span className="brand-mark">A</span>
            <span className="brand-name">AdaptiveHire</span>
          </NavLink>

          <nav className="topnav">
            {items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="topbar-end">
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
