import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AuthShell } from '../components/AuthShell';
import { authApi } from '../lib/endpoints';

/**
 * Asks for a reset link.
 *
 * The confirmation screen is shown for **any** address that is well-formed,
 * whether or not it has an account. That is not vagueness for its own sake: the
 * endpoint is unauthenticated, so a page that said "no account with that email"
 * would let anyone check which addresses are registered here — including which
 * of a company's staff are recruiters on this platform. The server already
 * refuses to tell us, and the UI must not invent an answer.
 *
 * The one thing that does change the outcome is a malformed address, which the
 * DTO rejects before anything is looked up. That is safe to surface: it is a
 * fact about what was typed, not about who exists.
 */
export function ForgotPassword() {
  const [params] = useSearchParams();

  // Carried over from the sign-in form, so nobody retypes what they just typed.
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await authApi.forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response
        ?.status;

      setError(
        status === 400
          ? 'That does not look like an email address.'
          : status === 429
            ? 'Too many requests. Wait a minute and try again.'
            : // A status at all means the API answered, so "can't reach it" would
              // send someone to check a server that is plainly running. Absent
              // status is the genuinely unreachable case.
              status
              ? 'Something went wrong at our end. Try again in a moment.'
              : 'Could not reach the API. Is the backend running on port 3001?',
      );
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        subtitle={`If ${email.trim()} has an AdaptiveHire account, a link to choose a new password is on its way.`}
        footer={
          <div>
            Remembered it? <Link to="/login">Back to sign in</Link>
          </div>
        }
      >
        <div className="auth-form">
          <p className="hint">
            The link works once and expires in an hour. It can take a minute to
            arrive — check your spam folder before asking for another.
          </p>
          <button
            type="button"
            className="auth-submit-btn"
            onClick={() => setSent(false)}
          >
            Use a different address
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the email you sign in with and we'll send you a link to choose a new password."
      footer={
        <div>
          Remembered it? <Link to="/login">Back to sign in</Link>
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
          <label htmlFor="email">Email</label>
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
              autoFocus
            />
          </div>
        </div>

        <button className="auth-submit-btn" type="submit" disabled={busy}>
          {busy ? (
            <>
              <span className="auth-spinner" aria-hidden="true" />
              Sending…
            </>
          ) : (
            'Send reset link'
          )}
        </button>
      </form>
    </AuthShell>
  );
}
