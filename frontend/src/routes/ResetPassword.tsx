import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthShell } from '../components/AuthShell';
import { useAuth } from '../lib/auth';
import { authApi } from '../lib/endpoints';

const MIN_LENGTH = 8;

/**
 * The page the emailed link lands on: `/reset-password?token=…`.
 *
 * Distinct from `SetPassword`, which is the forced change for an account whose
 * first password was emailed to it. That one asks for the current password
 * because the account is already signed in and the endpoint verifies it. Here
 * there is no session and no current password to give — possession of a live,
 * single-use token is the whole proof — so the two cannot share a form.
 *
 * Success sends them to sign in rather than straight into the app. The reset
 * revokes every existing session server-side, so there is nothing to log in
 * with but the password they just chose, and signing in with it proves it took.
 */
export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { logout } = useAuth();

  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when the token is refused, which is not recoverable on this page. */
  const [expired, setExpired] = useState(false);

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && password !== confirm;
  const ready = password.length >= MIN_LENGTH && password === confirm;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;

    setBusy(true);
    setError(null);

    /*
     * Only the reset itself is inside the try.
     *
     * `logout()` used to be in here too, and it rejects with a 401 whenever the
     * visitor is signed out — which is the normal case, since they arrived from
     * an email. That rejection landed in this catch and reported a *successful*
     * reset as "something went wrong, your password has not been changed",
     * which was untrue and left them retrying a link that was now spent.
     *
     * The rule this encodes: once an irreversible action has succeeded, nothing
     * after it may surface as a failure.
     */
    try {
      await authApi.resetPassword(token, password);
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response
        ?.status;

      if (status === 400) {
        // The server will not say which of expired / used / unknown it was, and
        // neither should this page. What matters to the person reading it is
        // the same either way: this link is spent, ask for another.
        setExpired(true);
      } else {
        setError(
          status === 429
            ? 'Too many attempts. Wait a minute and try again.'
            : // See ForgotPassword: a status means the API answered, so telling
              // someone to check whether it is running is a wrong lead.
              status
              ? 'Something went wrong at our end. Your password has not been changed.'
              : 'Could not reach the API. Is the backend running on port 3001?',
        );
      }
      setBusy(false);
      return;
    }

    // Past here the password IS changed. Clearing any session held in this tab
    // matters for two reasons — the sign-in page bounces an already-signed-in
    // visitor away from the confirmation, and the server has already revoked
    // the refresh token, leaving an access token that works for a few more
    // minutes and then fails oddly. Failure is swallowed: `logout` clears local
    // state in a `finally` before it rethrows, so the part that matters has
    // happened either way.
    await logout().catch(() => undefined);
    void navigate('/login?reset=1', { replace: true });
  };

  // Someone opened /reset-password directly, with nothing to redeem.
  if (!token) {
    return (
      <AuthShell
        title="No reset link"
        subtitle="This page needs the link from your email to work."
        footer={
          <div>
            <Link to="/forgot-password">Ask for a reset link</Link>
          </div>
        }
      >
        <div className="auth-form">
          <p className="hint">
            Open the link in the email we sent, or request a new one.
          </p>
        </div>
      </AuthShell>
    );
  }

  if (expired) {
    return (
      <AuthShell
        title="This link has expired"
        subtitle="Reset links work once and last an hour. Ask for a fresh one and it will take a moment."
        footer={
          <div>
            Remembered your password? <Link to="/login">Back to sign in</Link>
          </div>
        }
      >
        <div className="auth-form">
          <Link to="/forgot-password">
            <button type="button" className="auth-submit-btn">
              Send me a new link
            </button>
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Pick something only you know. You'll sign in with it straight after."
      footer={
        <div>
          Remembered your password? <Link to="/login">Back to sign in</Link>
        </div>
      }
    >
      <form className="auth-form" onSubmit={(e) => void submit(e)}>
        {error && (
          <div className="auth-error-alert" role="alert">
            <svg
              className="auth-error-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              width={16}
              height={16}
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <div className="field">
          <label htmlFor="password">New password</label>
          <div className="field-input-wrap">
            <svg
              className="field-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              width={17}
              height={17}
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
            />
            <button
              type="button"
              className="field-pw-toggle"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              tabIndex={-1}
            >
              {showPassword ? (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  width={16}
                  height={16}
                >
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  width={16}
                  height={16}
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
          {tooShort && (
            <p className="field-note error-note">
              At least {MIN_LENGTH} characters.
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="confirm">Confirm new password</label>
          <div className="field-input-wrap">
            <svg
              className="field-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              width={17}
              height={17}
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <input
              id="confirm"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="Type it again"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>
          {mismatch && (
            <p className="field-note error-note">These two do not match yet.</p>
          )}
        </div>

        <button
          className="auth-submit-btn"
          type="submit"
          disabled={!ready || busy}
        >
          {busy ? (
            <>
              <span className="auth-spinner" aria-hidden="true" />
              Saving…
            </>
          ) : (
            'Save and sign in'
          )}
        </button>
      </form>
    </AuthShell>
  );
}
