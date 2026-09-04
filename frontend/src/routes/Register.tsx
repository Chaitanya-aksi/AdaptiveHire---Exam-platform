import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthShell } from '../components/AuthShell';
import { homeFor } from '../components/ProtectedRoute';
import { landingCopy, useSplash } from '../components/Splash';
import { useAuth } from '../lib/auth';
import { describeError } from '../lib/errors';

const MIN_PASSWORD = 8;

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const splash = useSplash();
  const [searchParams] = useSearchParams();

  const [fullName, setFullName] = useState('');
  // Invite emails link here with ?email=… pre-filled, so the address matches
  // the invitation. It stays editable — it's a convenience, not a token.
  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit =
    fullName.trim().length >= 2 &&
    email.trim().length > 0 &&
    password.length >= MIN_PASSWORD &&
    password === confirm;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError(null);

    try {
      const user = await register({
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        accountType: 'candidate',
      });
      // Same beat as a sign-in, and for the same reason: raised before the
      // navigation and in the same tick, so the destination mounts and fetches
      // underneath the overlay instead of after it. It carries the welcome a
      // toast used to — one greeting, on the screen that is already holding
      // this moment, rather than a second one sliding in behind it.
      splash.show(landingCopy(user, 'sign-up'));
      void navigate(homeFor(user.role), { replace: true });
    } catch (err) {
      const response = (
        err as { response?: { status?: number; data?: { message?: string } } }
      ).response;
      const status = response?.status;
      setError(
        status === 409
          ? 'An account with that email already exists. Sign in instead.'
          : status === 403
            ? // The backend gates registration to invited emails; show its
              // explanation rather than the generic access-denied text.
              (response?.data?.message ??
              'This email has not been invited. Ask the recruiter who contacted you.')
            : describeError(err, 'Could not create your account.'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="Register as a candidate to take your invited assessments."
      footer={
        // Only the other audience's door. "Already have an account?" is now a
        // button inside the form, and saying it twice would make neither look
        // like the answer.
        <div className="auth-alt-secondary">
          Hiring instead?{' '}
          <Link to="/recruiter/register">Register to host assessments</Link>
        </div>
      }
    >
      <form className="auth-form" onSubmit={(e) => void submit(e)}>
        {error && <div className="alert error">{error}</div>}

        <div className="field">
          <label htmlFor="fullName">Full name</label>
          <input
            id="fullName"
            autoComplete="name"
            placeholder="John Doe"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={150}
            required
          />
        </div>

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
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <p className="field-note">Use at least {MIN_PASSWORD} characters.</p>
        </div>

        <div className="field">
          <label htmlFor="confirm">Confirm password</label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            placeholder="Repeat your password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
          {mismatch && (
            <p className="field-note error-note">
              Passwords don&rsquo;t match.
            </p>
          )}
        </div>

        <button
          className="primary block"
          type="submit"
          disabled={!canSubmit || busy}
        >
          {busy ? 'Creating account…' : 'Create account'}
        </button>

      {/*
        The way back, matching the sign-up button on the sign-in page. Somebody
        who followed that link and then realised they already have an account
        should not have to find their way back through the small print.
      */}
      <div className="auth-alt-sep">
        <span>Already have an account?</span>
      </div>
      <Link className="auth-alt-btn" to="/login">
        Sign in instead
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

      <div className="hint">
        Candidate accounts are created for <strong>invited emails only</strong>.
        If yours isn&rsquo;t recognised, ask the recruiter who contacted you to
        add it.
      </div>
    </AuthShell>
  );
}
