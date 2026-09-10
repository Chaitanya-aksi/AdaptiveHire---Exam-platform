import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { SupportContact } from '../components/SupportContact';
import { landingCopy, useSplash } from '../components/Splash';
import { useAuth } from '../lib/auth';
import { publicEntryApi } from '../lib/endpoints';
import { describeServerError } from '../lib/errors';
import { formatDuration } from '../lib/schedule';
import type { PublicAssessmentIntro } from '../lib/types';

const MIN_PASSWORD = 8;

/**
 * The candidate's way in through a shared link — `/a/<token>`.
 *
 * This is the only page on the platform that an anonymous visitor can use to
 * reach an assessment, and it exists because invitation email has never been
 * deliverable from production. See `docs/public-assessment-links.md`.
 *
 * ── Why the email is asked for on its own screen ──
 * Three things can only be said once the address is known, and every one of
 * them is better said before somebody chooses a password: that this link only
 * accepts one email domain, that the round has closed, and whether this person
 * already has an account and should be entering a password rather than
 * inventing one.
 *
 * It does mean the first step answers "does this address have an account" to
 * anyone who asks. That is a real cost, taken deliberately: a single combined
 * form leaks the same fact anyway — a new address succeeds where an existing
 * one with a wrong password fails — while also being unable to say any of the
 * three things above until after the fact. The rate limit on the endpoint is
 * what bounds the leak; the shape of the form never could.
 */
export function PublicEntry() {
  const { token = '' } = useParams<{ token: string }>();
  const { adoptSession } = useAuth();
  const navigate = useNavigate();
  const splash = useSplash();

  const [intro, setIntro] = useState<PublicAssessmentIntro | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * Which of the two screens is showing.
   *
   * `email` first, then whichever the server said. The client never decides
   * this — it renders what step one returned, and step two re-decides it
   * server-side anyway from its own records.
   */
  const [step, setStep] = useState<'email' | 'create' | 'password'>('email');

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    publicEntryApi
      .intro(token)
      .then((data) => {
        if (!cancelled) setIntro(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(describeServerError(err, 'This link is not valid.'));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const checkEmail = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const result = await publicEntryApi.check(token, email.trim());
      // The normalised address the server made its decision about, not what was
      // typed — step two must be asked about the same value step one answered.
      setEmail(result.email);
      setStep(result.step);
    } catch (err) {
      setError(describeServerError(err, 'Could not check that address.'));
    } finally {
      setBusy(false);
    }
  };

  const enter = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const result = await publicEntryApi.enter(token, {
        email,
        password,
        // Only read when an account is being created; the server ignores it
        // otherwise, so sending it on the sign-in path changes nothing.
        fullName: step === 'create' ? fullName.trim() : undefined,
      });

      adoptSession(result.accessToken, result.user);
      splash.show(landingCopy(result.user, step === 'create' ? 'sign-up' : 'sign-in'));
      // Straight to the assessment they came for, rather than to a list holding
      // one item. They followed a link about one specific round.
      void navigate(`/assessments/${result.invitationId}`, { replace: true });
    } catch (err) {
      setError(
        describeServerError(
          err,
          step === 'create'
            ? 'Could not create your account.'
            : 'Could not sign you in.',
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  /** Back to the address, keeping nothing that belonged to the other branch. */
  const changeEmail = () => {
    setStep('email');
    setPassword('');
    setConfirm('');
    setError(null);
  };

  if (loadError) {
    return (
      <PublicShell>
        <div className="pe-closed">
          <h1>This link is not valid</h1>
          <p>{loadError}</p>
          <p className="pe-muted">
            Check that you copied the whole address, or ask whoever sent it for
            a new one.
          </p>
        </div>
      </PublicShell>
    );
  }

  if (!intro) {
    return (
      <PublicShell>
        <div className="empty">Loading…</div>
      </PublicShell>
    );
  }

  const { organisation, assessment } = intro;

  // Closed, expired, full or not open yet. The assessment is still named and
  // still branded — somebody holding this URL already knows what it is, and a
  // bare error would send them hunting for a typo that is not there.
  if (intro.state !== 'open') {
    return (
      <PublicShell organisation={organisation}>
        <div className="pe-closed">
          <h1>{assessment.title}</h1>
          <p>{intro.message}</p>
          <SupportContact
            organisation={organisation}
            assessmentTitle={assessment.title}
          />
        </div>
      </PublicShell>
    );
  }

  const mismatch = confirm.length > 0 && confirm !== password;
  const canCreate =
    fullName.trim().length >= 2 &&
    password.length >= MIN_PASSWORD &&
    password === confirm;

  return (
    <PublicShell organisation={organisation}>
      <div className="pe-card">
        <header className="pe-head">
          <p className="pe-org">{organisation.name} is hiring</p>
          <h1>{assessment.title}</h1>
          {assessment.description && <p className="pe-desc">{assessment.description}</p>}
        </header>

        {assessment.sections.length > 0 && (
          <div className="pe-sections">
            <ul>
              {assessment.sections.map((section) => (
                <li key={section.name}>
                  <span>{section.name}</span>
                  <span className="pe-muted">
                    {formatDuration(section.timeLimitSeconds)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="pe-muted pe-total">
              {/* An upper bound, not a promise — a section that finishes early
                  gives the rest of its clock back. */}
              Up to {formatDuration(assessment.totalTimeSeconds)} in total
            </p>
          </div>
        )}

        {error && <div className="alert error">{error}</div>}

        {step === 'email' ? (
          <form className="auth-form" onSubmit={(e) => void checkEmail(e)}>
            <div className="field">
              <label htmlFor="pe-email">Your email address</label>
              <input
                id="pe-email"
                type="email"
                autoComplete="username"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
              {intro.emailDomain && (
                <p className="field-note">
                  This round accepts <strong>@{intro.emailDomain}</strong>{' '}
                  addresses only.
                </p>
              )}
            </div>

            <button
              className="primary block"
              type="submit"
              disabled={busy || email.trim().length === 0}
            >
              {busy ? 'Checking…' : 'Continue'}
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={(e) => void enter(e)}>
            <div className="pe-identity">
              <span>{email}</span>
              <button type="button" className="linkish" onClick={changeEmail}>
                Change
              </button>
            </div>

            {step === 'create' ? (
              <>
                <div className="field">
                  <label htmlFor="pe-name">Full name</label>
                  <input
                    id="pe-name"
                    autoComplete="name"
                    placeholder="John Doe"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    maxLength={150}
                    required
                    autoFocus
                  />
                </div>

                <div className="field">
                  <label htmlFor="pe-password">Choose a password</label>
                  <input
                    id="pe-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <p className="field-note">
                    You will use this to sign in and to come back to your
                    results.
                  </p>
                </div>

                <div className="field">
                  <label htmlFor="pe-confirm">Confirm password</label>
                  <input
                    id="pe-confirm"
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
                  disabled={!canCreate || busy}
                >
                  {busy ? 'Setting up…' : 'Create account and continue'}
                </button>
              </>
            ) : (
              <>
                {/*
                  The password is not optional and cannot be made so. A
                  candidate account is shared across every company that invites
                  that person, so letting somebody in on a typed address alone
                  would hand them another person's results elsewhere.
                */}
                <div className="field">
                  <label htmlFor="pe-existing">Your password</label>
                  <input
                    id="pe-existing"
                    type="password"
                    autoComplete="current-password"
                    placeholder="Your AdaptiveHire password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoFocus
                  />
                  <p className="field-note">
                    You already have an AdaptiveHire account with this address.
                  </p>
                </div>

                <button
                  className="primary block"
                  type="submit"
                  disabled={busy || password.length === 0}
                >
                  {busy ? 'Signing in…' : 'Sign in and continue'}
                </button>

                <p className="pe-muted pe-forgot">
                  <Link to="/forgot-password">Forgotten your password?</Link>
                </p>
              </>
            )}
          </form>
        )}
      </div>
    </PublicShell>
  );
}

/**
 * The frame around all four states of this page.
 *
 * Deliberately not `AuthShell`. That one is a marketing panel for AdaptiveHire,
 * and this page belongs to the company doing the hiring — a candidate arriving
 * from a job post has no idea what AdaptiveHire is and no reason to be sold it.
 * The company's own name and logo lead instead, resolved by the same rule the
 * portal uses.
 */
function PublicShell({
  organisation,
  children,
}: {
  organisation?: PublicAssessmentIntro['organisation'];
  children: React.ReactNode;
}) {
  return (
    <div
      className="pe-page"
      // The company's accent, where it has one. Set as a variable rather than
      // on individual rules so the card and the button pick it up together.
      style={
        organisation?.accentColor
          ? ({ '--pe-accent': organisation.accentColor } as React.CSSProperties)
          : undefined
      }
    >
      <div className="pe-frame">
        {organisation && (
          <header className="pe-brand">
            {organisation.logoUrl ? (
              <img src={organisation.logoUrl} alt="" className="pe-logo" />
            ) : (
              <span className="pe-mark" aria-hidden="true">
                {organisation.name.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="pe-brand-name">{organisation.name}</span>
          </header>
        )}

        {children}

        <footer className="pe-footer">
          <span>Assessment delivered by AdaptiveHire</span>
        </footer>
      </div>
    </div>
  );
}
