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
      subtitle="Sign in to see the assessments you've been invited to take."
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

      {/*
        Dev convenience only. Gated on import.meta.env.DEV so the bundler drops
        it from a production build entirely — working credentials printed on a
        public sign-in page is not something to rely on remembering to remove.
      */}
      {import.meta.env.DEV && (
        <div className="hint">
          Seeded accounts — password <code>ChangeMe!2345</code>
          <br />
          <code>candidate@adaptivehire.local</code> · candidate
          <br />
          <code>recruiter@adaptivehire.local</code> · recruiter_admin
        </div>
      )}
    </AuthShell>
  );
}
