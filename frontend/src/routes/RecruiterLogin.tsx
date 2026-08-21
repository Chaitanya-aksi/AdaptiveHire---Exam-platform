import { Link } from 'react-router-dom';
import { AuthShell } from '../components/AuthShell';
import { SignInForm } from '../components/SignInForm';

/**
 * The recruiter entry point. Same endpoint and same form as the candidate side —
 * only the framing differs, plus the way in for a company that has not signed up
 * yet. Recruiter accounts used to be provisioned from the People page by someone
 * who already had one; they are now self-service, and registering creates the
 * company's own workspace.
 */
export function RecruiterLogin() {
  return (
    <AuthShell
      title="Recruiter sign in"
      subtitle="Manage assessments, the question bank, and candidate reports."
      footer={
        <>
          <div>
            New here?{' '}
            <Link to="/recruiter/register">Register to host assessments</Link>
          </div>
          <div className="auth-alt-secondary">
            Taking an assessment? <Link to="/login">Candidate sign in</Link>
          </div>
        </>
      }
    >
      <SignInForm portal="recruiter" />

      
    </AuthShell>
  );
}
