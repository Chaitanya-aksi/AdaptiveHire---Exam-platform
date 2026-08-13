import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { homeFor } from './ProtectedRoute';
import { useAuth } from '../lib/auth';
import type { LoginPortal } from '../lib/types';

/** Where to send someone who used the wrong form, per portal. */
const OTHER_DOOR: Record<LoginPortal, { to: string; label: string }> = {
  candidate: { to: '/recruiter/login', label: 'Go to recruiter sign in' },
  recruiter: { to: '/login', label: 'Go to candidate sign in' },
};

/**
 * The sign-in form itself, shared by the candidate and recruiter entry points.
 *
 * The two pages differ in wording and in `portal`, which tells the server which
 * door this is. An account of the wrong kind is refused with a 403 and pointed
 * at its own page — the client cannot do that check itself, because a successful
 * login has already set the refresh cookie by the time the role is known, and
 * the next reload would restore the session regardless of what the UI showed.
 */
export function SignInForm({ portal }: { portal: LoginPortal }) {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Set when the credentials were right but the door was wrong. */
  const [wrongDoor, setWrongDoor] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setWrongDoor(false);

    try {
      const user = await login(email, password, portal);
      void navigate(homeFor(user.role), { replace: true });
    } catch (err) {
      const response = (
        err as { response?: { status?: number; data?: { message?: string } } }
      ).response;
      const status = response?.status;

      // 403 means the password was right but this is the other audience's form.
      // Show the server's wording and a link, rather than the flat "not
      // recognised" that would leave someone retyping a correct password.
      if (status === 403) {
        setWrongDoor(true);
        setError(
          response?.data?.message ??
            'That account signs in on the other page.',
        );
      } else {
        setError(
          status === 401
            ? 'That email and password combination was not recognised.'
            : status === 429
              ? 'Too many attempts. Wait a minute and try again.'
              : 'Could not reach the API. Is the backend running on port 3001?',
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={(e) => void submit(e)}>
      {error && (
        <div className="alert error">
          {error}
          {wrongDoor && (
            <>
              {' '}
              <Link to={OTHER_DOOR[portal].to}>{OTHER_DOOR[portal].label}</Link>
            </>
          )}
        </div>
      )}

      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>

      <button className="primary block" type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
