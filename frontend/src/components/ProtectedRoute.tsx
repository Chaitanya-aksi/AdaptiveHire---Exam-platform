import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import type { UserRole } from '../lib/types';

/** The forced password change for invitation-created accounts. */
export const SET_PASSWORD_PATH = '/set-password';

/** Where each role lands when it has no business being where it asked to go. */
export const homeFor = (role: UserRole): string =>
  role === 'recruiter_admin' ? '/admin' : '/assessments';

export function ProtectedRoute({
  allow,
  children,
}: {
  allow: UserRole[];
  children: ReactNode;
}) {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Wait for the silent refresh; redirecting first would bounce a signed-in
  // user to the login screen on every reload.
  if (loading) {
    return <div className="empty">Loading…</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!allow.includes(user.role)) {
    return <Navigate to={homeFor(user.role)} replace />;
  }

  /*
   * An account created by an invitation is still using the password we
   * generated and emailed in plaintext, so it is not really theirs yet. Gate
   * every protected route on replacing it — here rather than on the assessment
   * list alone, so no other route becomes an accidental way around it.
   *
   * `/set-password` is naturally exempt, or the redirect would chase itself.
   */
  if (user.mustChangePassword && location.pathname !== SET_PASSWORD_PATH) {
    return <Navigate to={SET_PASSWORD_PATH} replace />;
  }

  return <>{children}</>;
}
