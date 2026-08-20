import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { IconArrow, IconAssessment, IconClock } from '../../components/Icons';
import { SupportContact } from '../../components/SupportContact';
import { describeWindow } from '../../lib/schedule';
import { invitationsApi } from '../../lib/endpoints';
import { describeError } from '../../lib/errors';
import type {
  AttemptPaceEntry,
  AttemptStage,
  CandidateAttemptView,
  InvitationStatus,
} from '../../lib/types';

/*
 * The candidate's own record of one assessment.
 *
 * Everything on this page is participation: what they were invited to, where it
 * has got to, how much they answered and how long they spent. Deliberately no
 * questions, no answers, no right/wrong and no score — that decision and its
 * reasons live in `backend/src/invitations/candidate-attempt.ts`, and the API
 * does not send those fields at all, so this page could not show them if it
 * tried.
 */

/** "8m 41s" / "43s" / "1h 04m". Compact, and never zero-padded at the front. */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${String(mins).padStart(2, '0')}m`;
}

function formatMoment(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** What, if anything, they can still do from here. */
function actionFor(status: InvitationStatus): string | null {
  if (status === 'pending') return 'Start assessment';
  if (status === 'in_progress') return 'Resume';
  return null;
}

/** The four-step bar across the top. State comes from the API, not from here. */
function StatusBar({ stages }: { stages: AttemptStage[] }) {
  return (
    <ol className="at-track">
      {stages.map((stage) => (
        <li key={stage.key} className={`at-step at-step--${stage.state}`}>
          <span className="at-step-marker" aria-hidden="true" />
          <div className="at-step-text">
            <strong>{stage.label}</strong>
            <span className="at-step-when">
              {stage.at
                ? formatMoment(stage.at)
                : stage.state === 'stopped'
                  ? 'Not reached'
                  : 'Not yet'}
            </span>
            <span className="at-step-note">{stage.note}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * How long each question took, longest bar to the slowest.
 *
 * Scaled against the slowest of the run rather than a fixed ceiling — the
 * comparison worth seeing is between their own questions.
 */
function PaceChart({ pace }: { pace: AttemptPaceEntry[] }) {
  const slowest = Math.max(...pace.map((entry) => entry.seconds ?? 0), 1);
  const multiSection = new Set(pace.map((entry) => entry.moduleName)).size > 1;

  return (
    <ol className="at-pace">
      {pace.map((entry) => (
        <li key={entry.sequenceNumber} className="at-pace-row">
          <span className="at-pace-n">Q{entry.sequenceNumber}</span>
          <span className="at-pace-track">
            <span
              className={`at-pace-bar${entry.answered ? '' : ' at-pace-bar--skipped'}`}
              style={{
                width: `${Math.max(((entry.seconds ?? 0) / slowest) * 100, 2)}%`,
              }}
            />
          </span>
          {multiSection && (
            <span className="at-pace-mod">{entry.moduleName}</span>
          )}
          <span className="at-pace-time">
            {entry.answered
              ? entry.seconds === null
                ? '—'
                : formatDuration(entry.seconds)
              : 'No answer'}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function AttemptDetail() {
  const { invitationId } = useParams<{ invitationId: string }>();

  const [view, setView] = useState<CandidateAttemptView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!invitationId) return;
    let cancelled = false;

    setLoading(true);
    invitationsApi
      .myAttempt(invitationId)
      .then((data) => {
        if (!cancelled) setView(data);
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
  }, [invitationId]);

  if (loading) {
    return (
      <>
        <Link to="/assessments" className="at-back">
          ← All assessments
        </Link>
        <div className="ci-skeleton" style={{ height: 180 }} />
      </>
    );
  }

  if (error || !view) {
    return (
      <>
        <Link to="/assessments" className="at-back">
          ← All assessments
        </Link>
        <div className="alert error">
          {error ?? 'Could not load this assessment.'}
        </div>
      </>
    );
  }

  const { assessment, attempt, invitation, stages } = view;

  // The window gates the button here for the same reason it does on the list:
  // the runtime refuses a session outside it, so offering Start early only
  // produces an error. `?? 'open'` keeps the page working against an API that
  // predates the field.
  const windowState = view.window?.state ?? 'open';
  const scheduleNote = view.window
    ? describeWindow(view.window, 'candidate')
    : null;
  const action = windowState === 'open' ? actionFor(invitation.status) : null;

  return (
    <>
      <Link to="/assessments" className="at-back">
        ← All assessments
      </Link>

      <header className="at-head">
        <div>
          {/* Branded by whoever sent this invitation, not by the viewer — the
              same candidate's next assessment may be for another company. */}
          {/* Accent on a rule under the strip, matching the list. On the badge
              alone it was invisible to any company that had also set a logo,
              since the badge only renders when there is none. */}
          <div
            className={`ci-org${view.organisation.accentColor ? ' ci-org--accented' : ''}`}
            style={
              view.organisation.accentColor
                ? { borderBottomColor: view.organisation.accentColor }
                : undefined
            }
          >
            {view.organisation.logoUrl ? (
              <img
                className="ci-org-logo"
                src={view.organisation.logoUrl}
                alt=""
              />
            ) : (
              <span
                className="ci-org-mark"
                aria-hidden="true"
                style={
                  view.organisation.accentColor
                    ? { background: view.organisation.accentColor }
                    : undefined
                }
              >
                {view.organisation.name.trim().charAt(0).toUpperCase()}
              </span>
            )}
            <span className="ci-org-name">{view.organisation.name}</span>
          </div>

          <h1>{assessment.title}</h1>
          {assessment.description && <p>{assessment.description}</p>}
        </div>

        {action ? (
          // Start goes via the readiness check, resume straight into the test —
          // see the note on the assessment card for why.
          <Link
            to={`/assessments/${invitation.id}/${
              invitation.status === 'pending' ? 'ready' : 'take'
            }`}
          >
            <button type="button" className="primary at-cta">
              {action}
              <IconArrow />
            </button>
          </Link>
        ) : (
          // Why there is no button, when the reason is the clock rather than
          // the attempt. Nothing is said when the window is simply open.
          scheduleNote &&
          windowState !== 'open' && (
            <span className="at-window-note">{scheduleNote}</span>
          )
        )}
      </header>

      {/* An approaching deadline while they can still sit it. Above the status
          bar, because it changes what they should do today. */}
      {windowState === 'open' && scheduleNote && (
        <p className="at-window-open">{scheduleNote}</p>
      )}

      <section className="card card-pad at-card">
        <h2 className="at-card-title">Where this has got to</h2>
        <StatusBar stages={stages} />
      </section>

      {attempt ? (
        <>
          <div className="at-stats">
            <div className="at-stat">
              <strong>{attempt.questionsAnswered}</strong>
              <span>Questions answered</span>
            </div>
            <div className="at-stat">
              <strong>{formatDuration(attempt.timeOnQuestionsSeconds)}</strong>
              <span>Time on questions</span>
            </div>
            <div className="at-stat">
              <strong>
                {attempt.averageSecondsPerQuestion === null
                  ? '—'
                  : formatDuration(attempt.averageSecondsPerQuestion)}
              </strong>
              <span>Average per question</span>
            </div>
          </div>

          {attempt.sections.length > 0 && (
            <section className="card at-card">
              <div className="card-head">
                <h2>Sections</h2>
              </div>
              <div className="card-pad at-sections">
                {attempt.sections.map((section) => (
                  <div className="at-section" key={section.moduleId}>
                    <div className="at-section-head">
                      <strong>{section.name}</strong>
                      <span
                        className={`ci-pill ci-pill--${
                          section.completedAt ? 'completed' : 'in_progress'
                        }`}
                      >
                        {section.completedAt ? 'Finished' : 'Not finished'}
                      </span>
                    </div>
                    <div className="ci-facts">
                      <span>
                        <IconAssessment width={14} height={14} />
                        {section.questionsAnswered} answered
                      </span>
                      <span>
                        <IconClock width={14} height={14} />
                        {formatDuration(section.timeOnQuestionsSeconds)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {attempt.pace.length > 0 && (
            <section className="card at-card">
              <div className="card-head">
                <h2>Your pace</h2>
                <span className="muted small">
                  Longest bar was your slowest question
                </span>
              </div>
              <div className="card-pad">
                <PaceChart pace={attempt.pace} />
              </div>
            </section>
          )}

          <p className="at-footnote">
            Times are measured on each question. Moving between questions is not
            counted here.
          </p>

          {/* Only on an attempt that exists. Before they have started there is
              nothing that can have been interrupted, and offering the route
              early invites "can I have longer" rather than "my power went". */}
          <SupportContact
            organisation={view.organisation}
            assessmentTitle={assessment.title}
            reference={invitation.id}
          />
        </>
      ) : (
        /* Nothing has been attempted yet, so the page describes what is coming
           instead of reporting on what happened. */
        <section className="card at-card">
          <div className="card-head">
            <h2>What to expect</h2>
          </div>
          <div className="card-pad at-sections">
            {assessment.sections.map((section) => (
              <div className="at-section" key={section.name}>
                <div className="at-section-head">
                  <strong>{section.name}</strong>
                </div>
                <div className="ci-facts">
                  <span>
                    <IconClock width={14} height={14} />
                    Up to {formatDuration(section.timeLimitSeconds)}
                  </span>
                </div>
              </div>
            ))}

            <p className="at-expect-note">
              Your camera needs to be on before each section can begin. The
              number of questions varies — the assessment adjusts as you go, so
              two people rarely answer exactly the same number.
            </p>
          </div>
        </section>
      )}
    </>
  );
}
