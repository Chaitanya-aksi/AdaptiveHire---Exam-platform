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
      <SignInForm portal="candidate" />

      {/*
        Dev convenience only. Gated on import.meta.env.DEV so the bundler drops
        it from a production build entirely — working credentials printed on a
        public sign-in page is not something to rely on remembering to remove.
      */}
      {/* Only the candidate account: this form refuses a recruiter now, so
          listing one here would just hand out a credential that fails. */}
      {import.meta.env.DEV && (
        <div className="hint">
          Seeded account — password <code>ChangeMe!2345</code>
          <br />
          <code>candidate@adaptivehire.local</code> · candidate
        </div>
      )}
    </AuthShell>
  );
}
