import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
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
 *
 * **Narrow screens get a drawer instead of the bar.** Six sections plus the
 * brand, the theme toggle and the account button need roughly 850px; below the
 * breakpoint they were competing for 400. The bar's own `overflow-x` covers the
 * middle sizes, so the drawer only takes over where scrolling a bar stops being
 * a reasonable way to find anything.
 *
 * Only the sections move. The theme toggle stays in the bar: it already drops
 * its labels below 900px, so it is three small icons by the time this matters —
 * and its radios carry a fixed `name`, so a second instance would join the same
 * radio group and fight the first over which one is checked.
 */
export function AppLayout() {
  const { user } = useAuth();
  const items = RECRUITER_NAV;

  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const menuId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Following a link has to dismiss the drawer, or the destination renders
  // underneath it. Keyed on the path so it also covers the browser back button.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  /*
   * Widening past the breakpoint has to close it, not just hide it. The CSS
   * stops displaying the drawer above 760px, but the open state would survive —
   * leaving the body scroll-locked below with nothing on screen to explain why.
   * Kept in step with the breakpoint in `index.css` by hand; there is no shared
   * source for it, and a mismatch shows up as exactly that stuck scroll.
   */
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 761px)');
    const sync = () => {
      if (wide.matches) setMenuOpen(false);
    };
    sync();
    wide.addEventListener('change', sync);
    return () => wide.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);

    // Without this the page scrolls behind the drawer, which reads as the
    // drawer itself being broken.
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    // Move focus in, so a keyboard or screen-reader user is actually taken to
    // the menu they just opened rather than left on the button behind it.
    firstLinkRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
    };
  }, [menuOpen]);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <button
            type="button"
            ref={toggleRef}
            className="nav-toggle"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => {
              // Returning focus to the button on close keeps keyboard
              // navigation from jumping back to the top of the document.
              if (menuOpen) toggleRef.current?.focus();
              setMenuOpen((open) => !open);
            }}
          >
            <span className="nav-toggle-icon" aria-hidden="true" />
          </button>

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

      {menuOpen && (
        <div
          className="nav-drawer-backdrop"
          // Presentational: Escape and every link already close the drawer, so
          // this is a pointer convenience rather than the only way out.
          role="presentation"
          onClick={closeMenu}
        />
      )}

      <nav
        id={menuId}
        className={`nav-drawer${menuOpen ? ' is-open' : ''}`}
        aria-label="Sections"
        // Genuinely removed when shut, so its links are not in the tab order
        // behind the page.
        hidden={!menuOpen}
      >
        {items.map((item, index) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            ref={index === 0 ? firstLinkRef : undefined}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
