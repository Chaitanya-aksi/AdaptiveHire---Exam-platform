import type { AuthUser, UserRole } from './types';

/**
 * A crumb of the last session, kept only so the page-load splash can name
 * where somebody is going before anyone knows who they are.
 *
 * Every load starts with no access token — it lives in memory and is traded
 * for with the httpOnly cookie — so at first paint the app cannot tell a
 * recruiter from a candidate. Same problem the theme mirror in `theme.tsx`
 * solves, and the same shape of answer: remember the one fact the first frame
 * needs, and let the real session correct it a moment later.
 *
 * Deliberately the *role* and nothing else. A name would have made the splash
 * warmer and the shared machines this platform runs on — a demo laptop, a
 * candidate kiosk — greet whoever sat there last by name before the sign-in
 * page appeared. A role is not worth reading over somebody's shoulder.
 */
const ROLE_KEY = 'adaptivehire.lastRole';

function isRole(value: string | null): value is UserRole {
  return value === 'candidate' || value === 'recruiter_admin';
}

/** The last settled session's role, or null when there is nothing to go on. */
export function readRoleHint(): UserRole | null {
  try {
    const stored = localStorage.getItem(ROLE_KEY);
    return isRole(stored) ? stored : null;
  } catch {
    // Private mode, or storage disabled. Callers treat this as "unknown".
    return null;
  }
}

/**
 * Record — or deliberately forget — whose side this browser is on.
 *
 * An account still on its emailed password is forgotten rather than
 * remembered: `ProtectedRoute` sends them to `/set-password`, so promising
 * them their assessments on the next load would name a screen they are not
 * about to see. Signing out forgets too, so the next visitor to a shared
 * machine gets the neutral line instead of the last occupant's.
 */
export function rememberSession(user: AuthUser | null): void {
  try {
    if (!user || user.mustChangePassword) localStorage.removeItem(ROLE_KEY);
    else localStorage.setItem(ROLE_KEY, user.role);
  } catch {
    // Not persisting costs one generic splash, not a broken session.
  }
}
