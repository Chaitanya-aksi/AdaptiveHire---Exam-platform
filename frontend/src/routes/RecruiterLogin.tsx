import { Link } from 'react-router-dom';
import { AuthShell } from '../components/AuthShell';
import { SignInForm } from '../components/SignInForm';

/**
 * The recruiter entry point. Same endpoint, same form — only the framing
 * differs, and there is no sign-up link: recruiter accounts are provisioned
 * from the People page by someone who already has one.
 */
export function RecruiterLogin() {
  return (
    <AuthShell
      title="Recruiter sign in"
      subtitle="Manage assessments, the question bank, and candidate reports."
      footer={
        <>
          <div>
            Taking an assessment? <Link to="/login">Candidate sign in</Link>
          </div>
          <div className="auth-alt-secondary">
            Need a recruiter account? Ask an existing recruiter to create one.
          </div>
        </>
      }
    >
      <SignInForm />

      {import.meta.env.DEV && (
        <div className="hint">
          Seeded account — password <code>ChangeMe!2345</code>
          <br />
          <code>recruiter@adaptivehire.local</code> · recruiter_admin
        </div>
      )}
    </AuthShell>
  );
}
