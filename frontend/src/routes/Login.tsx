import { Link } from 'react-router-dom';
import { AuthShell } from '../components/AuthShell';
import { SignInForm } from '../components/SignInForm';

/**
 * The default door. Candidates are the overwhelming majority of sign-ins, so
 * this page is written for them; recruiters get a signposted side entrance.
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
      <SignInForm />

      {/* Dev-only: dropped from production builds by the bundler */}
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
          <div className="auth-demo-row">
            <span className="auth-demo-key">Recruiter</span>
            <code>recruiter@adaptivehire.local</code>
          </div>
        </div>
      )}
    </AuthShell>
  );
}
