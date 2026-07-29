import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { UserMenu } from './UserMenu';
import { homeFor } from './ProtectedRoute';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

// "My account" is deliberately absent here — it lives in the user menu, so it
// doesn't compete with the working pages for space in the top bar.
const RECRUITER_NAV: NavItem[] = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/questions', label: 'Question bank' },
  { to: '/admin/import', label: 'Bulk import' },
  { to: '/admin/modules', label: 'Modules' },
  { to: '/admin/assessments', label: 'Assessments' },
  { to: '/admin/people', label: 'People' },
];

const CANDIDATE_NAV: NavItem[] = [
  { to: '/assessments', label: 'My assessments', end: true },
];

export function AppLayout() {
  const { user } = useAuth();
  const items = user?.role === 'recruiter_admin' ? RECRUITER_NAV : CANDIDATE_NAV;

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

          <UserMenu />
        </div>
      </header>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
