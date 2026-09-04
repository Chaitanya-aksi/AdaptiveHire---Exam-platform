import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { homeFor } from './ProtectedRoute';
import { landingCopy, useSplash } from './Splash';
import { useAuth } from '../lib/auth';
import type { LoginPortal } from '../lib/types';

/** Where to send someone who used the wrong form, per portal. */
const OTHER_DOOR: Record<LoginPortal, { to: string; label: string }> = {
  candidate: { to: '/recruiter/login', label: 'Go to recruiter sign in' },
  recruiter: { to: '/login', label: 'Go to candidate sign in' },
};

/**
 * The way on for somebody who has no account yet — a button under the form
 * rather than a line of small print below the panel.
 *
 * Signing in and signing up are the only two things this page is for, and a
 * visitor who cannot do the first needs the second to be visible without
 * hunting. `lead` is the question the button answers, so the pair reads as one
 * sentence.
 */
const SIGN_UP: Record<
  LoginPortal,
  { to: string; label: string; lead: string; inline: string }
> = {
  candidate: {
    to: '/register',
    label: 'Create a candidate account',
    lead: 'New to AdaptiveHire?',
    inline: 'Create an account',
  },
  recruiter: {
    to: '/recruiter/register',
    label: 'Register to host assessments',
    lead: 'No account yet?',
    inline: 'Register your company',
  },
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
  const splash = useSplash();
  const [params] = useSearchParams();

  /**
   * Set by the reset page on its way here. Worth confirming: the reset signs
   * out every session, so arriving at a sign-in form is the expected outcome
   * rather than a sign that nothing happened.
   */
  const justReset = params.get('reset') === '1';

  /**
   * The address an invitation email already knows.
   *
   * Every invite links to `/login?email=…` (built in `InvitationsService`), and
   * until this was read the parameter went nowhere: somebody arriving from
   * their inbox — holding a password they cannot possibly remember — was shown
   * an empty form and asked to type back the address the link was carrying.
   * That is the moment a first-time candidate is most likely to give up, and
   * it was self-inflicted.
   *
   * Only a starting value, not a lock: the field stays editable, because the
   * link may have been forwarded to the person who should actually sit the
   * assessment.
   */
  const invitedEmail = params.get('email')?.trim() ?? '';

  const [email, setEmail] = useState(invitedEmail);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Set when the credentials were right but the door was wrong. */
  const [wrongDoor, setWrongDoor] = useState(false);
  /**
   * Set when the pair was refused, which is the only answer a sign-in should
   * give: the server will not say whether the email exists, because that turns
   * this form into a way to test which addresses hold accounts. So the offer to
   * sign up is worded as a question rather than a diagnosis — the person knows
   * which of the two they are, and this form deliberately does not.
   */
  const [offerSignUp, setOfferSignUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setWrongDoor(false);
    setOfferSignUp(false);

    try {
      const user = await login(email, password, portal);
      // Raised before the navigation, and in the same tick, so React commits
      // the overlay and the route change together. Reversing the two would
      // paint a frame of the half-built destination first, which is precisely
      // the moment the splash exists to cover.
      splash.show(landingCopy(user, 'sign-in'));
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
          response?.data?.message ?? 'That account signs in on the other page.',
        );
      } else {
        setOfferSignUp(status === 401);
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
      {justReset && !error && (
        <div className="auth-ok-alert" role="status">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            width={16}
            height={16}
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="8,12.5 11,15.5 16,9" />
          </svg>
          <span>Password changed. Sign in with your new one.</span>
        </div>
      )}

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
          {/* Wrapped so the icon/text flex layout still holds once the
              wrong-door link is appended to the message. */}
          <span>
            {error}
            {wrongDoor && (
              <>
                {' '}
                <Link to={OTHER_DOOR[portal].to}>
                  {OTHER_DOOR[portal].label}
                </Link>
              </>
            )}
            {offerSignUp && (
              <>
                {' '}
                Never signed up?{' '}
                <Link to={SIGN_UP[portal].to}>{SIGN_UP[portal].inline}</Link>
              </>
            )}
          </span>
        </div>
      )}

      <div className="field">
        <label htmlFor="email">Email or Candidate ID</label>
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
          />
        </div>
      </div>

      <div className="field">
        <div className="field-header">
          <label htmlFor="password">Password</label>
          {/* Carries whatever has been typed so far, so nobody retypes their
              address on the next screen. Empty is fine — the field there is
              simply blank. */}
          <Link
            to={`/forgot-password${
              email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ''
            }`}
            className="field-forgot"
          >
            Forgot password?
          </Link>
        </div>
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
            autoComplete="current-password"
            placeholder="Enter your password"
            /* Arriving from an invitation, the only thing left to do here is
               paste the emailed password, so start in that field rather than
               in one that is already filled in. */
            autoFocus={Boolean(invitedEmail)}
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
              <svg
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                width={10}
                height={10}
              >
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
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              width={16}
              height={16}
              aria-hidden="true"
            >
              <path d="M4 10h12M11 5l5 5-5 5" />
            </svg>
          </>
        )}
      </button>

      {/*
        Inside the form, under the submit button, because that is where someone
        who has just failed to sign in is already looking — the same place the
        cross-links used to sit was below the whole panel, where a visitor with
        no account had to go looking for the one thing they needed.
      */}
      <div className="auth-alt-sep">
        <span>{SIGN_UP[portal].lead}</span>
      </div>
      <Link className="auth-alt-btn" to={SIGN_UP[portal].to}>
        {SIGN_UP[portal].label}
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          width={15}
          height={15}
          aria-hidden="true"
        >
          <path d="M4 10h12M11 5l5 5-5 5" />
        </svg>
      </Link>
    </form>
  );
}
