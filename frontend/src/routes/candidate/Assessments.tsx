import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { invitationsApi } from '../../lib/endpoints';
import { describeError } from '../../lib/errors';
import type { CandidateInvitation, InvitationStatus } from '../../lib/types';

/** What the candidate can do with an invitation, given its status. */
function actionFor(status: InvitationStatus): {
  label: string | null;
  note: string;
} {
  switch (status) {
    case 'pending':
      return { label: 'Start assessment', note: 'Not started yet' };
    case 'in_progress':
      // The session is resumable: /sessions/start rejoins rather than restarts.
      return { label: 'Resume', note: 'You have an attempt in progress' };
    case 'completed':
      return { label: null, note: 'Submitted — the recruiting team has it' };
    case 'expired':
      return { label: null, note: 'This invitation has expired' };
    case 'revoked':
      return { label: null, note: 'This invitation was withdrawn' };
  }
}

/**
 * The candidate's home: everything they have been invited to, and the way in
 * to the test itself.
 */
export function Assessments() {
  const { user } = useAuth();
  const [invites, setInvites] = useState<CandidateInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invitationsApi
      .mine()
      .then(setInvites)
      .catch((err) =>
        setError(describeError(err, 'Could not load your assessments.')),
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My assessments</h1>
          <p>Assessments you have been invited to take.</p>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading ? (
        <div className="empty">Loading…</div>
      ) : invites.length === 0 ? (
        <div className="card empty">
          <strong style={{ display: 'block', marginBottom: 6 }}>
            Nothing here yet
          </strong>
          <span>
            {user?.fullName}, you have no assessment invitations. A recruiter
            will invite you when one is ready.
          </span>
        </div>
      ) : (
        <div className="stack">
          {invites.map((invite) => {
            const action = actionFor(invite.status);

            return (
              <div className="card card-pad" key={invite.id}>
                <div className="spread">
                  <div>
                    <h2 style={{ margin: 0 }}>{invite.assessment.title}</h2>
                    {invite.assessment.description && (
                      <p className="muted small" style={{ margin: '4px 0 0' }}>
                        {invite.assessment.description}
                      </p>
                    )}
                    <p className="muted small" style={{ margin: '6px 0 0' }}>
                      {action.note}
                    </p>
                  </div>

                  <div className="row">
                    <span className="badge">{invite.status}</span>
                    {action.label && (
                      <Link to={`/assessments/${invite.id}/take`}>
                        <button type="button" className="primary">
                          {action.label}
                        </button>
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
