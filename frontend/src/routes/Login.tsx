import { Link } from 'react-router-dom';
import { AuthShell } from '../components/AuthShell';
import { SignInForm } from '../components/SignInForm';

/**
 * The default door, and candidates only. They are the overwhelming majority of
 * sign-ins, so this page is written for them; recruiters get a signposted side
 * entrance and are refused here, with a link across, rather than quietly let
 * through into the admin area.
 */
export function Login() {
  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to access your assessment account."
      footer={
        <>
          <div>
            New to AdaptiveHire? <Link to="/register">Create an account</Link>
          </div>
          <div className="auth-alt-secondary">
            Recruiter or admin? <Link to="/recruiter/login">Sign in here</Link>
          </div>
        </>
      }
    >
      <SignInForm portal="candidate" />

      {/*
        Dev-only: gated on import.meta.env.DEV so the bundler drops it from a
        production build entirely — working credentials printed on a public
        sign-in page is not something to rely on remembering to remove.

        The recruiter account is deliberately not listed. This form is candidate-
        only now and refuses a recruiter with a 403, so offering that credential
        here would hand out one that cannot work.
      */}
      {import.meta.env.DEV && (
        <div className="auth-demo">
          <p className="auth-demo-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" width={12} height={12} aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Demo access
          </p>
          <div className="auth-demo-row">
            <span className="auth-demo-key">Password</span>
            <code>ChangeMe!2345</code>
          </div>
          <div className="auth-demo-row">
            <span className="auth-demo-key">Candidate</span>
            <code>candidate@adaptivehire.local</code>
          </div>
        </div>
      )}
    </AuthShell>
  );
}
