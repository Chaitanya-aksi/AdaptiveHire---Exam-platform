import { Link } from 'react-router-dom';
import { useCandidateInvites } from '../../components/CandidateLayout';
import { IconArrow, IconAssessment, IconClock } from '../../components/Icons';
import { describeWindow } from '../../lib/schedule';
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
      return { label: null, note: 'Submitted — sent to the recruiting team for review.' };
    case 'expired':
      return { label: null, note: 'This invitation has expired' };
    case 'revoked':
      return { label: null, note: 'This invitation was withdrawn' };
  }
}

/** Short status word for the pill. The note underneath carries the detail. */
const STATUS_LABEL: Record<InvitationStatus, string> = {
  pending: 'Not started',
  in_progress: 'In progress',
  completed: 'Submitted',
  expired: 'Expired',
  revoked: 'Withdrawn',
};

const isOpen = (invite: CandidateInvitation) =>
  invite.status === 'pending' || invite.status === 'in_progress';

/** "45 min" — the whole test's ceiling, rounded to something readable. */
function duration(totalSeconds: number): string | null {
  if (totalSeconds <= 0) return null;
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

function invitedOn(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function InviteCard({ invite }: { invite: CandidateInvitation }) {
  const status = actionFor(invite.status);
  const { assessment } = invite;

  /*
   * The window gates the button, and it wins over the status.
   *
   * `/sessions/start` refuses a session outside the window, so a Start button
   * offered before the round opens is a button that produces an error message
   * — the precise failure `assessment-window.ts` was written to prevent. The
   * state comes resolved from the server rather than being recomputed here,
   * because the clock that enforces the window is not this one.
   *
   * Defaulted rather than asserted: this field was added to the payload after
   * the page shipped, so an API not yet redeployed sends nothing, and a
   * candidate should lose a line of copy rather than their Start button.
   */
  const windowState = invite.window?.state ?? 'open';
  const scheduleNote = invite.window
    ? describeWindow(invite.window, 'candidate')
    : null;

  const action =
    windowState === 'open'
      ? status
      : {
          label: null,
          note:
            windowState === 'not_yet'
              ? `This ${scheduleNote?.toLowerCase() ?? 'assessment has not opened yet'}.`
              : 'This assessment has closed.',
        };
  // Defaulted, not asserted: both fields were added to this payload after the
  // page shipped, so an API that has not been redeployed yet sends neither —
  // the card should lose a chip line, not blow up in the candidate's face.
  const modules = assessment.modules ?? [];
  const length = duration(assessment.totalTimeSeconds ?? 0);
  const sent = invitedOn(invite.createdAt);

  return (
    <article className={`ci-card ci-card--${invite.status}`}>
      <div className="ci-stripe" aria-hidden="true" />

      <div className="ci-body">
        {/*
         * Who is asking, before what they are asking.
         *
         * A candidate holding invitations from three companies needs to tell
         * them apart at a glance, and the company they applied to is the thing
         * they recognise — not the internal title of the assessment. The accent
         * is applied to this strip only, never to the whole page, because the
         * next card down may belong to somebody else entirely.
         *
         * It lands on a rule under the strip rather than on the initial badge
         * alone. The badge is the fallback for a company with no logo, so
         * hanging the accent on it meant that anyone who set both a logo and a
         * colour saw neither — which is the ordinary case, since a company with
         * branding to configure usually has a logo.
         *
         * Deliberately not the status bar down the left edge: that encodes
         * whether the attempt is unstarted, running or submitted, and trading a
         * signal the candidate needs for decoration is not a good swap.
         */}
        <div
          className={`ci-org${invite.organisation.accentColor ? ' ci-org--accented' : ''}`}
          // The colour is carried inline because it is per-company data, not a
          // theme. Safe to interpolate: the API accepts only a literal
          // `#rrggbb`, which is why that validation is strict rather than
          // "any CSS colour".
          style={
            invite.organisation.accentColor
              ? { borderBottomColor: invite.organisation.accentColor }
              : undefined
          }
        >
          {invite.organisation.logoUrl ? (
            <img
              className="ci-org-logo"
              src={invite.organisation.logoUrl}
              alt=""
              loading="lazy"
            />
          ) : (
            <span
              className="ci-org-mark"
              aria-hidden="true"
              style={
                invite.organisation.accentColor
                  ? { background: invite.organisation.accentColor }
                  : undefined
              }
            >
              {invite.organisation.name.trim().charAt(0).toUpperCase()}
            </span>
          )}
          <span className="ci-org-name">{invite.organisation.name}</span>
        </div>

        <div className="ci-head">
          {/*
           * The title's link is stretched over the whole card in CSS, so
           * clicking anywhere opens the record — a submitted invitation used to
           * be a dead end. It stays a real anchor around the title so the
           * keyboard and the status line get one honest, describable target,
           * rather than a div with an onClick. The button below sits above the
           * stretched area and still goes straight into the test.
           */}
          <h2>
            <Link to={`/assessments/${invite.id}`} className="ci-open">
              {assessment.title}
            </Link>
          </h2>
          <span className={`ci-pill ci-pill--${invite.status}`}>
            {STATUS_LABEL[invite.status]}
          </span>
        </div>

        {assessment.description && (
          <p className="ci-desc">{assessment.description}</p>
        )}

        {modules.length > 0 && (
          <ul className="ci-modules">
            {modules.map((name) => (
              <li key={name} className="ci-chip">
                {name}
              </li>
            ))}
          </ul>
        )}

        <div className="ci-foot">
          <div className="ci-facts">
            {length && (
              <span>
                <IconClock width={14} height={14} />
                Up to {length}
              </span>
            )}
            {modules.length > 0 && (
              <span>
                <IconAssessment width={14} height={14} />
                {modules.length} section{modules.length === 1 ? '' : 's'}
              </span>
            )}
            {/* Shown while the window is open too, so a deadline is visible
                before it becomes the reason a button is missing. */}
            {scheduleNote && (
              <span>
                <IconClock width={14} height={14} />
                {scheduleNote}
              </span>
            )}
            {sent && <span className="ci-fact-sent">Invited {sent}</span>}
          </div>

          {action.label ? (
            // Starting goes through the readiness check; resuming does not.
            // Somebody mid-assessment has already passed it, their clock is
            // running, and making them re-run a camera probe would cost them
            // time for nothing.
            <Link
              to={`/assessments/${invite.id}/${
                invite.status === 'pending' ? 'ready' : 'take'
              }`}
              className="ci-go"
            >
              <button type="button" className="primary">
                {action.label}
                <IconArrow />
              </button>
            </Link>
          ) : (
            /* Not a link: the stretched one on the title already covers the
               card, and nesting a second anchor inside it would be invalid. */
            <span className="ci-view" aria-hidden="true">
              View record
              <IconArrow />
            </span>
          )}
        </div>

        <p className="ci-note">{action.note}</p>
      </div>
    </article>
  );
}

/**
 * The candidate's home: everything they have been invited to, and the way in
 * to the test itself.
 *
 * The list itself is loaded by `CandidateLayout`, because the greeting panel
 * beside this column counts the same rows.
 */
export function Assessments() {
  const { invites, loading, error } = useCandidateInvites();

  const open = invites.filter(isOpen);
  const closed = invites.filter((invite) => !isOpen(invite));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Your assessments</h1>
          <p>Everything you have been invited to take.</p>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading ? (
        <div className="ci-list">
          {/* Placeholders rather than a bare "Loading…": the column keeps its
              shape, so nothing jumps when the rows land. */}
          <div className="ci-skeleton" />
          <div className="ci-skeleton" />
        </div>
      ) : invites.length === 0 ? (
        <div className="ci-empty">
          <span className="ci-empty-ico" aria-hidden="true">
            <IconAssessment width={26} height={26} />
          </span>
          <strong>No assessments yet</strong>
          <p>
            When a recruiting team invites you to an assessment, it appears here
            and you can start it straight from this page.
          </p>
        </div>
      ) : (
        <>
          {open.length > 0 && (
            <div className="ci-list">
              {open.map((invite) => (
                <InviteCard key={invite.id} invite={invite} />
              ))}
            </div>
          )}

          {closed.length > 0 && (
            <>
              <h2 className="ci-section">
                {open.length > 0 ? 'Earlier' : 'Your history'}
              </h2>
              <div className="ci-list">
                {closed.map((invite) => (
                  <InviteCard key={invite.id} invite={invite} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
