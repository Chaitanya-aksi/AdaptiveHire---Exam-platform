import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthShell } from '../components/AuthShell';
import { homeFor } from '../components/ProtectedRoute';
import { useToast } from '../components/Toast';
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
  const toast = useToast();

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
      toast.success(`Welcome, ${user.fullName.split(' ')[0]}.`);
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
        <>
          <div>
            Already have a recruiter account?{' '}
            <Link to="/recruiter/login">Sign in</Link>
          </div>
          <div className="auth-alt-secondary">
            Taking an assessment? <Link to="/login">Candidate sign in</Link>
          </div>
        </>
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
