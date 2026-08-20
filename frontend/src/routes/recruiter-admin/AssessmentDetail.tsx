import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  IconArrow,
  IconAssessment,
  IconClock,
  IconModules,
  IconPeople,
} from '../../components/Icons';
import {
  assessmentsApi,
  invitationsApi,
  reportsApi,
} from '../../lib/endpoints';
import { describeError } from '../../lib/errors';
import type {
  Assessment,
  AssessmentInvitation,
  AttemptListItem,
  InvitationStatus,
  SessionStatus,
} from '../../lib/types';
import {
  RECOMMENDATION_BADGE,
  RECOMMENDATION_LABEL,
} from './AssessmentReports';

const SESSION_LABEL: Record<SessionStatus, string> = {
  in_progress: 'Taking it now',
  completed: 'Completed',
  auto_submitted: 'Auto-submitted',
  abandoned: 'Abandoned',
};

/** Maps onto the existing badge palette rather than inventing new colours. */
const SESSION_BADGE: Record<SessionStatus, string> = {
  in_progress: 'draft',
  completed: 'active',
  auto_submitted: 'active',
  abandoned: 'archived',
};

const INVITATION_LABEL: Record<InvitationStatus, string> = {
  pending: 'Not started',
  in_progress: 'Taking it now',
  completed: 'Completed',
  expired: 'Expired',
  revoked: 'Revoked',
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function formatDay(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
}

/**
 * One person's standing on this assessment.
 *
 * Invitations and attempts arrive as two independent lists, and a recruiter
 * asking "who is taking this?" wants one answer, not two lists to reconcile by
 * eye. They are joined on the email because that is the only key both sides are
 * guaranteed to share: invitations are email-keyed, and `candidateId` is only
 * backfilled once the invitee registers.
 */
interface Person {
  email: string;
  name: string | null;
  registered: boolean;
  invitedAt: string | null;
  invitationStatus: InvitationStatus | null;
  attempt: AttemptListItem | null;
}

function joinPeople(
  invitations: AssessmentInvitation[],
  attempts: AttemptListItem[],
): Person[] {
  const byEmail = new Map<string, Person>();

  for (const invite of invitations) {
    byEmail.set(invite.email.toLowerCase(), {
      email: invite.email,
      name: invite.candidateName,
      registered: invite.registered,
      invitedAt: invite.createdAt,
      invitationStatus: invite.status,
      attempt: null,
    });
  }

  for (const attempt of attempts) {
    const key = attempt.candidate.email.toLowerCase();
    const existing = byEmail.get(key);

    if (existing) {
      existing.attempt = attempt;
      // The account is the better source for a display name once it exists.
      existing.name = attempt.candidate.fullName || existing.name;
      existing.registered = true;
    } else {
      // An attempt with no matching invitation should not be possible — a
      // session is started from one — but dropping it silently would hide a real
      // candidate, so it is shown rather than assumed away.
      byEmail.set(key, {
        email: attempt.candidate.email,
        name: attempt.candidate.fullName,
        registered: true,
        invitedAt: null,
        invitationStatus: null,
        attempt,
      });
    }
  }

  return [...byEmail.values()];
}

/**
 * Everything about one assessment on a single page: how it is configured, and
 * who is taking or has taken it.
 *
 * Reached by clicking the title in the list. The three existing sub-pages
 * (questions, invite, results) stay exactly where they were and are linked from
 * the header — this is the overview that was missing between them.
 */
export function AssessmentDetail() {
  const { id } = useParams<{ id: string }>();

  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    Promise.all([
      assessmentsApi.get(id),
      invitationsApi.forAssessment(id),
      reportsApi.forAssessment(id),
    ])
      .then(([found, invitations, attempts]) => {
        if (cancelled) return;
        setAssessment(found);
        setPeople(joinPeople(invitations, attempts));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(describeError(err, 'Could not load this assessment.'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return <div className="empty">Loading…</div>;
  if (error) return <div className="alert error">{error}</div>;
  if (!assessment) return null;

  const minQ = assessment.modules.reduce((t, m) => t + m.minQuestions, 0);
  const maxQ = assessment.modules.reduce((t, m) => t + m.maxQuestions, 0);
  const minutes = Math.round(
    assessment.modules.reduce((t, m) => t + m.timeLimitSeconds, 0) / 60,
  );
  const curated = assessment.questionPool.length > 0;

  // "Taken or taking" against "yet to start" — the split the page exists for.
  // A type predicate rather than a `!` at each use: the filter already proves
  // the attempt is there, so the narrowing belongs here where it is checked.
  const started = people.filter(
    (p): p is Person & { attempt: AttemptListItem } => p.attempt !== null,
  );
  const waiting = people.filter((p) => p.attempt === null);
  const finished = started.filter((p) => p.attempt.status !== 'in_progress');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{assessment.title}</h1>
          <p>
            {assessment.description || 'No description.'}
            <span className="muted small">
              {' · '}Created {formatDay(assessment.createdAt)}
            </span>
          </p>
        </div>
        <Link to="/admin/assessments">Back to assessments</Link>
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        <Link className="button" to={`/admin/assessments/${assessment.id}/questions`}>
          Questions{curated && ` (${assessment.questionPool.length})`}
        </Link>
        <Link className="button" to={`/admin/assessments/${assessment.id}/invite`}>
          Invite candidates
        </Link>
        <Link
          className="button primary"
          to={`/admin/assessments/${assessment.id}/results`}
        >
          Full results
        </Link>
      </div>

      <dl className="stat-row">
        <div className="stat-tile">
          <dt>
            <IconModules width={13} height={13} /> Subjects
          </dt>
          <dd>{assessment.modules.length}</dd>
          <p className="muted small">
            {assessment.modules
              .map((m) => m.module?.name)
              .filter(Boolean)
              .join(' · ') || '—'}
          </p>
        </div>

        <div className="stat-tile">
          <dt>
            <IconAssessment width={13} height={13} /> Questions
          </dt>
          {/* A range, not a number: the engine adapts, so two candidates rarely
              answer the same count. */}
          <dd>{minQ === maxQ ? minQ : `${minQ}–${maxQ}`}</dd>
          <p className="muted small">
            {curated
              ? `Drawn from ${assessment.questionPool.length} chosen questions`
              : 'Drawn from your whole question bank'}
          </p>
        </div>

        <div className="stat-tile">
          <dt>
            <IconClock width={13} height={13} /> Time limit
          </dt>
          <dd>{minutes} min</dd>
          <p className="muted small">Across every module</p>
        </div>

        <div className="stat-tile">
          <dt>
            <IconPeople width={13} height={13} /> Candidates
          </dt>
          <dd>{people.length}</dd>
          <p className="muted small">
            {finished.length} completed · {started.length - finished.length} in
            progress · {waiting.length} yet to start
          </p>
        </div>
      </dl>

      <div className="card">
        <div className="card-head">
          <h2>Module setup</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Module</th>
                <th style={{ width: 120 }}>Scoring</th>
                <th style={{ width: 140 }}>Questions</th>
                <th style={{ width: 120 }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {assessment.modules.map((m) => (
                <tr key={m.id}>
                  <td>
                    <strong>{m.module?.name ?? m.moduleId}</strong>
                  </td>
                  <td>
                    <span
                      className={`badge ${m.module?.scoringType === 'trait' ? 'accent' : ''}`}
                    >
                      {m.module?.scoringType ?? '—'}
                    </span>
                  </td>
                  <td>
                    {m.minQuestions === m.maxQuestions
                      ? m.minQuestions
                      : `${m.minQuestions}–${m.maxQuestions}`}
                  </td>
                  <td>{Math.round(m.timeLimitSeconds / 60)} min</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <h2>Taken or taking it</h2>
          <span className="badge">{started.length}</span>
        </div>

        {started.length === 0 ? (
          <div className="card-pad muted">
            Nobody has started this assessment yet.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th style={{ width: 140 }}>Status</th>
                  <th style={{ width: 90 }}>Answers</th>
                  <th style={{ width: 90 }}>Score</th>
                  <th style={{ width: 170 }}>Recommendation</th>
                  <th style={{ width: 180 }}>Submitted</th>
                  <th style={{ width: 150 }} />
                </tr>
              </thead>
              <tbody>
                {started.map((person) => {
                  const { attempt } = person;
                  return (
                    <tr key={person.email}>
                      <td>
                        <strong>{person.name ?? person.email}</strong>
                        <div className="muted small">{person.email}</div>
                      </td>
                      <td>
                        <span className={`badge ${SESSION_BADGE[attempt.status]}`}>
                          {SESSION_LABEL[attempt.status]}
                        </span>
                      </td>
                      <td>{attempt.questionsAnswered}</td>
                      <td>
                        {attempt.overallScore === null ? (
                          <span className="muted">—</span>
                        ) : (
                          <strong>{attempt.overallScore}</strong>
                        )}
                      </td>
                      <td>
                        {attempt.hiringRecommendation ? (
                          <span
                            className={`badge ${RECOMMENDATION_BADGE[attempt.hiringRecommendation]}`}
                          >
                            {RECOMMENDATION_LABEL[attempt.hiringRecommendation]}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="muted small">
                        {formatDate(attempt.submittedAt)}
                      </td>
                      <td>
                        {/* Same control as on the Results page, so the two
                            cannot drift apart visually. */}
                        <Link
                          className="button soft"
                          to={`/admin/reports/${attempt.sessionId}`}
                        >
                          Open report
                          <IconArrow className="button-go" width={15} height={15} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <h2>Yet to start</h2>
          <span className="badge">{waiting.length}</span>
        </div>

        {waiting.length === 0 ? (
          <div className="card-pad muted">
            {people.length === 0
              ? 'Nobody has been invited yet.'
              : 'Everyone invited has started.'}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th style={{ width: 150 }}>Status</th>
                  <th style={{ width: 190 }}>Account</th>
                  <th style={{ width: 180 }}>Invited</th>
                </tr>
              </thead>
              <tbody>
                {waiting.map((person) => (
                  <tr key={person.email}>
                    <td>
                      <strong>{person.name ?? person.email}</strong>
                      {person.name && (
                        <div className="muted small">{person.email}</div>
                      )}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          person.invitationStatus === 'revoked' ||
                          person.invitationStatus === 'expired'
                            ? 'archived'
                            : ''
                        }`}
                      >
                        {person.invitationStatus
                          ? INVITATION_LABEL[person.invitationStatus]
                          : 'Not started'}
                      </span>
                    </td>
                    <td className="muted small">
                      {/* Worth showing: an invitee with no account yet cannot
                          sign in, so they physically cannot have started. */}
                      {person.registered
                        ? 'Registered'
                        : 'Has not registered yet'}
                    </td>
                    <td className="muted small">{formatDay(person.invitedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
