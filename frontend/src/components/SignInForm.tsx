import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { homeFor } from './ProtectedRoute';
import { useAuth } from '../lib/auth';

export function SignInForm() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

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
            : 'Could not reach the API. Is the backend running on port 3002?',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={(e) => void submit(e)}>

      {error && (
        <div className="auth-error-alert" role="alert">
          <svg className="auth-error-icon" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={2} strokeLinecap="round"
            strokeLinejoin="round" width={16} height={16}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </div>
      )}

      <div className="field">
        <label htmlFor="email">Email or Candidate ID</label>
        <div className="field-input-wrap">
          <svg className="field-icon" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"
            strokeLinejoin="round" width={17} height={17}>
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
          </svg>
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
      </div>

      <div className="field">
        <div className="field-header">
          <label htmlFor="password">Password</label>
          <a href="#" className="field-forgot" tabIndex={-1}
            onClick={(e) => e.preventDefault()}>
            Forgot password?
          </a>
        </div>
        <div className="field-input-wrap">
          <svg className="field-icon" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"
            strokeLinejoin="round" width={17} height={17}>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button
            type="button"
            className="field-pw-toggle"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            tabIndex={-1}
          >
            {showPassword ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
                width={16} height={16}>
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
                width={16} height={16}>
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <div className="auth-remember-row">
        <label className="auth-remember-label">
          <input
            type="checkbox"
            className="auth-remember-checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
          />
          <span className="auth-remember-box" aria-hidden="true">
            {rememberMe && (
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor"
                strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"
                width={10} height={10}>
                <polyline points="2,6 5,9 10,3" />
              </svg>
            )}
          </span>
          <span>Remember me</span>
        </label>
      </div>

      <button className="auth-submit-btn" type="submit" disabled={busy}>
        {busy ? (
          <>
            <span className="auth-spinner" aria-hidden="true" />
            Signing in…
          </>
        ) : (
          <>
            Sign in
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor"
              strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
              width={16} height={16} aria-hidden="true">
              <path d="M4 10h12M11 5l5 5-5 5" />
            </svg>
          </>
        )}
      </button>

    </form>
  );
}
