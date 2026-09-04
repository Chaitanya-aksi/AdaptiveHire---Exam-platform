import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthShell } from '../components/AuthShell';
import { homeFor } from '../components/ProtectedRoute';
import { landingCopy, useSplash } from '../components/Splash';
import { useAuth } from '../lib/auth';
import { describeError } from '../lib/errors';

const MIN_PASSWORD = 8;

/**
 * Recruiter sign-up, sitting alongside the recruiter sign-in rather than mixed
 * into the candidate form.
 *
 * The two sides of the platform want different things and are reached
 * differently: candidates arrive from an invite email and their account is only
 * created for an invited address, while a recruiter arrives cold and is
 * registering a company. Keeping them on separate pages means neither form asks
 * a question the visitor has no reason to answer.
 */
export function RecruiterRegister() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const splash = useSplash();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [organisationName, setOrganisationName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit =
    fullName.trim().length >= 2 &&
    email.trim().length > 0 &&
    // A company workspace has to be named: it is the boundary that keeps this
    // account's assessments and candidates apart from every other customer's.
    organisationName.trim().length >= 2 &&
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
        accountType: 'recruiter',
        organisationName: organisationName.trim(),
      });
      // Same beat as a sign-in, and for the same reason: raised before the
      // navigation and in the same tick, so the destination mounts and fetches
      // underneath the overlay instead of after it. It carries the welcome a
      // toast used to — one greeting, on the screen that is already holding
      // this moment, rather than a second one sliding in behind it.
      splash.show(landingCopy(user, 'sign-up'));
      void navigate(homeFor(user.role), { replace: true });
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response
        ?.status;
      setError(
        status === 409
          ? 'An account with that email already exists. Sign in instead.'
          : describeError(err, 'Could not create your account.'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Host assessments"
      subtitle="Register your company to build adaptive assessments, invite candidates and read their reports."
      footer={
        // Only the other audience's door — "already have an account" is now a
        // button inside the form.
        <div className="auth-alt-secondary">
          Taking an assessment? <Link to="/login">Candidate sign in</Link>
        </div>
      }
    >
      <form className="auth-form" onSubmit={(e) => void submit(e)}>
        {error && <div className="alert error">{error}</div>}

        <div className="field">
          <label htmlFor="fullName">Your name</label>
          <input
            id="fullName"
            autoComplete="name"
            placeholder="Priya Nair"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={150}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="organisationName">Company or organisation</label>
          <input
            id="organisationName"
            autoComplete="organization"
            placeholder="Acme Corp"
            value={organisationName}
            onChange={(e) => setOrganisationName(e.target.value)}
            maxLength={200}
            required
          />
          <p className="field-note">
            Everything you create lives here. Two companies may share a name
            without sharing anything else.
          </p>
        </div>

        <div className="field">
          <label htmlFor="email">Work email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            placeholder="you@company.com"
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
          {busy ? 'Creating your workspace…' : 'Create account'}
        </button>

      {/*
        The way back, matching the sign-up button on the sign-in page. Somebody
        who followed that link and then realised they already have an account
        should not have to find their way back through the small print.
      */}
      <div className="auth-alt-sep">
        <span>Already have an account?</span>
      </div>
      <Link className="auth-alt-btn" to="/recruiter/login">
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
        You&rsquo;ll own <strong>your company&rsquo;s</strong> workspace, with
        the platform question bank ready to use plus any questions you write
        yourself. Nobody outside your company can see your assessments,
        candidates or reports.
      </div>
    </AuthShell>
  );
}
