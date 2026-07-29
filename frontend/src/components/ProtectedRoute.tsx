import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import type { UserRole } from '../lib/types';

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

  return <>{children}</>;
}
