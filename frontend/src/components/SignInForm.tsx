import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { homeFor } from './ProtectedRoute';
import { useAuth } from '../lib/auth';

/**
 * The sign-in form itself, shared by the candidate and recruiter entry points.
 *
 * Those two pages differ only in wording. The request is identical: the server
 * decides the role from the credentials, and the client never asserts one —
 * so signing in through the "wrong" door still lands you in the right place.
 */
export function SignInForm() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const user = await login(email, password);
      void navigate(homeFor(user.role), { replace: true });
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      setError(
        status === 401
          ? 'That email and password combination was not recognised.'
          : status === 429
            ? 'Too many attempts. Wait a minute and try again.'
            : 'Could not reach the API. Is the backend running on port 3001?',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={(e) => void submit(e)}>
      {error && <div className="alert error">{error}</div>}

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
