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
        // The button under the form takes a recruiter to their sign-in; this
        // catches the other half of that visitor — the one whose company has no
        // workspace yet. Candidate registration is deliberately not linked from
        // anywhere on this page: an invitation provisions the account and emails
        // the credentials, so there is nothing here for a candidate to create.
        <div className="auth-alt-secondary">
          New company? <Link to="/recruiter/register">Register to host assessments</Link>
        </div>
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
    </AuthShell>
  );
}
