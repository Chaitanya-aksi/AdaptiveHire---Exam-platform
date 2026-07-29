import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import type { UserRole } from '../lib/types';

const ROLE_LABEL: Record<UserRole, string> = {
  recruiter_admin: 'Recruiter / Admin',
  candidate: 'Candidate',
};

/** Up to two initials from a display name, for the avatar. */
export function initials(name: string | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (parts[0][0] + last).toUpperCase();
}

/** The profile route each role's layout mounts under. */
export const profilePath = (role: UserRole | undefined): string =>
  role === 'recruiter_admin' ? '/admin/profile' : '/assessments/profile';

/**
 * The account button in the top bar. It lives in a sticky header, so unlike
 * the old sidebar footer it can never be pushed below the fold — sign-out is
 * always two clicks away from any page.
 */
export function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Navigating away should not leave the menu hanging open over the new page.
  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const signOut = async () => {
    setOpen(false);
    await logout();
    void navigate('/login', { replace: true });
  };

  return (
    <div className="user-menu" ref={wrapRef}>
      <button
        type="button"
        className={`user-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="avatar">{initials(user?.fullName)}</span>
        <span className="user-trigger-text">
          <strong>{user?.fullName}</strong>
          <span>{user ? ROLE_LABEL[user.role] : ''}</span>
        </span>
        <span className="chevron" aria-hidden="true" />
      </button>

      {open && (
        <div className="user-dropdown" role="menu">
          <div className="user-dropdown-head">
            <span className="avatar">{initials(user?.fullName)}</span>
            <div style={{ minWidth: 0 }}>
              <strong>{user?.fullName}</strong>
              <span className="muted small" title={user?.email}>
                {user?.email}
              </span>
            </div>
          </div>

          <div className="user-dropdown-items">
            <button
              type="button"
              role="menuitem"
              onClick={() => void navigate(profilePath(user?.role))}
            >
              <span className="mi" aria-hidden="true">
                ◍
              </span>
              My account
            </button>

            <button
              type="button"
              role="menuitem"
              className="signout"
              onClick={() => void signOut()}
            >
              <span className="mi" aria-hidden="true">
                ⤴
              </span>
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
