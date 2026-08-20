import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { IconArrow } from '../../components/Icons';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { assessmentsApi, reportsApi } from '../../lib/endpoints';
import { describeError } from '../../lib/errors';
import { formatWhen } from '../../lib/schedule';
import type {
  AttemptListItem,
  CandidateMessage,
  HiringRecommendation,
  ReviewDecision,
  ReviewPatch,
} from '../../lib/types';

export const RECOMMENDATION_LABEL: Record<HiringRecommendation, string> = {
  strongly_recommended: 'Strongly recommended',
  recommended: 'Recommended',
  borderline: 'Borderline',
  not_recommended: 'Not recommended',
};

/** Maps onto the existing badge palette rather than inventing new colours. */
export const RECOMMENDATION_BADGE: Record<HiringRecommendation, string> = {
  strongly_recommended: 'active',
  recommended: 'active',
  borderline: 'draft',
  not_recommended: 'archived',
};

type SortKey = 'score' | 'standing' | 'submitted' | 'name';
type Band = 'all' | 'shortlisted' | 'rejected' | 'undecided';

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

/** Ordinal suffix — 1st, 2nd, 3rd, 11th. */
function ordinal(n: number): string {
  const teens = n % 100;
  if (teens >= 11 && teens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/**
 * Nulls always sort last, whichever direction is chosen.
 *
 * An unscored attempt is missing data, not a low score; letting it float to the
 * top of an ascending sort would put candidates who never finished above ones
 * who did badly, which is not what "sort by score" means to anybody.
 */
function compareNullable(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

/**
 * The same rule for a standing, where 1 is the best and so sorts first.
 *
 * A separate function rather than negating `compareNullable`, which would flip
 * the null handling with it and float unranked attempts to the top.
 */
function compareRank(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/** The cohort: everyone who has attempted one assessment, and what to do next. */
export function AssessmentReports() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();

  const [title, setTitle] = useState('');
  const [attempts, setAttempts] = useState<AttemptListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sort, setSort] = useState<SortKey>('score');
  const [band, setBand] = useState<Band>('all');
  const [search, setSearch] = useState('');
  /** Which row's note editor is open. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  /** Which row's manual re-send is in flight. */
  const [notifying, setNotifying] = useState<string | null>(null);

  /**
   * The candidate being written to, and what has already been said to them.
   *
   * The history is loaded when the composer opens rather than with the table:
   * most rows are never written to, and it is the one thing a recruiter
   * reopening a conversation actually needs to see first.
   */
  const [contacting, setContacting] = useState<AttemptListItem | null>(null);
  const [draftMessage, setDraftMessage] = useState('');
  const [history, setHistory] = useState<CandidateMessage[] | null>(null);
  const [sendingMessage, setSendingMessage] = useState(false);

  const openContact = (row: AttemptListItem) => {
    setContacting(row);
    setDraftMessage('');
    setHistory(null);
    reportsApi
      .messages(row.sessionId)
      .then(setHistory)
      // A failed history load must not block writing — it is context, not a
      // precondition. An empty list reads the same as "nothing sent yet", so
      // the error is surfaced rather than silently rendering as no history.
      .catch((err) =>
        toast.error(describeError(err, 'Could not load earlier messages.')),
      );
  };

  const sendMessage = async () => {
    if (!contacting || !draftMessage.trim()) return;

    setSendingMessage(true);
    try {
      const sent = await reportsApi.sendMessage(
        contacting.sessionId,
        draftMessage,
      );
      toast.success(`Message sent to ${sent.sentTo}.`);
      setContacting(null);
    } catch (err) {
      toast.error(describeError(err, 'Could not send that message.'));
    } finally {
      setSendingMessage(false);
    }
  };

  useEffect(() => {
    if (!id) return;

    Promise.all([assessmentsApi.get(id), reportsApi.forAssessment(id)])
      .then(([assessment, rows]) => {
        setTitle(assessment.title);
        setAttempts(rows);
      })
      .catch((err) => setError(describeError(err, 'Could not load attempts.')))
      .finally(() => setLoading(false));
  }, [id]);

  /**
   * Applies a change and folds the server's answer back into the row.
   *
   * The response is used rather than the optimistic value because it carries
   * `updatedBy` and `updatedAt` — a colleague's name appearing against a note
   * is the point of sharing them.
   */
  const patch = async (sessionId: string, changes: ReviewPatch) => {
    setSaving(sessionId);
    try {
      const review = await reportsApi.saveReview(sessionId, changes);
      setAttempts((rows) =>
        rows.map((row) =>
          row.sessionId === sessionId ? { ...row, review } : row,
        ),
      );
    } catch (err) {
      toast.error(describeError(err, 'Could not save that.'));
    } finally {
      setSaving(null);
    }
  };

  /**
   * The manual re-send, for a row the click did not email.
   *
   * Only reachable for an attempt rejected before this was built, or one whose
   * send failed because the queue was down — rejecting now emails on the click
   * itself.
   */
  const resendRejection = async (row: AttemptListItem) => {
    setNotifying(row.sessionId);
    try {
      const { sentAt, to } = await reportsApi.sendRejectionEmail(row.sessionId);
      setAttempts((rows) =>
        rows.map((r) =>
          r.sessionId === row.sessionId && r.review
            ? { ...r, review: { ...r.review, rejectionEmailSentAt: sentAt } }
            : r,
        ),
      );
      toast.success(`Rejection email sent to ${to}.`);
    } catch (err) {
      // The API is specific — "mark as rejected first", "already sent on …" —
      // so its message is more useful than anything written here.
      toast.error(describeError(err, 'Could not send that email.'));
    } finally {
      setNotifying(null);
    }
  };

  /**
   * Clicking the active decision again clears it, rather than being a dead end.
   *
   * Rejecting emails the candidate as part of the same request, so the toast
   * says so — a message that has already gone should never be something the
   * recruiter finds out about later. Clearing the decision afterwards does not
   * unsend it, and the toast is where that becomes obvious.
   */
  const decide = async (row: AttemptListItem, decision: ReviewDecision) => {
    const clearing = row.review?.decision === decision;
    const willEmail =
      !clearing && decision === 'rejected' && !row.review?.rejectionEmailSentAt;

    await patch(row.sessionId, { decision: clearing ? null : decision });

    if (willEmail) {
      toast.success(
        `${row.candidate.fullName} was rejected and emailed at ${row.candidate.email}.`,
      );
    }
  };

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();

    const filtered = attempts.filter((row) => {
      if (band === 'shortlisted' && row.review?.decision !== 'shortlisted') {
        return false;
      }
      if (band === 'rejected' && row.review?.decision !== 'rejected') {
        return false;
      }
      if (band === 'undecided' && row.review?.decision) return false;

      if (!term) return true;
      return (
        row.candidate.fullName.toLowerCase().includes(term) ||
        row.candidate.email.toLowerCase().includes(term) ||
        (row.review?.tags ?? []).some((tag) => tag.toLowerCase().includes(term))
      );
    });

    return [...filtered].sort((a, b) => {
      switch (sort) {
        case 'standing':
          return compareRank(a.rank, b.rank);
        case 'submitted':
          return compareNullable(
            a.submittedAt ? Date.parse(a.submittedAt) : null,
            b.submittedAt ? Date.parse(b.submittedAt) : null,
          );
        case 'name':
          return a.candidate.fullName.localeCompare(b.candidate.fullName);
        case 'score':
        default:
          return compareNullable(a.overallScore, b.overallScore);
      }
    });
  }, [attempts, band, search, sort]);

  const counts = useMemo(
    () => ({
      shortlisted: attempts.filter((a) => a.review?.decision === 'shortlisted')
        .length,
      rejected: attempts.filter((a) => a.review?.decision === 'rejected')
        .length,
    }),
    [attempts],
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Results</h1>
          <p>{title || 'Loading…'}</p>
        </div>
        <Link to="/admin/assessments">Back to assessments</Link>
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading ? (
        <div className="empty">Loading…</div>
      ) : attempts.length === 0 ? (
        <div className="card empty">
          No one has started this assessment yet. Invited candidates appear here
          once they begin.
        </div>
      ) : (
        <>
          <div className="toolbar">
            <input
              className="search"
              placeholder="Search name, email or tag"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <select
              value={band}
              onChange={(e) => setBand(e.target.value as Band)}
              aria-label="Filter by decision"
            >
              <option value="all">Everyone ({attempts.length})</option>
              <option value="shortlisted">
                Shortlisted ({counts.shortlisted})
              </option>
              <option value="undecided">
                Undecided (
                {attempts.length - counts.shortlisted - counts.rejected})
              </option>
              <option value="rejected">Rejected ({counts.rejected})</option>
            </select>

            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label="Sort by"
            >
              <option value="score">Highest score</option>
              <option value="standing">Best standing</option>
              <option value="submitted">Most recent</option>
              <option value="name">Name</option>
            </select>

            <button
              type="button"
              disabled={exporting || shown.length === 0}
              onClick={() => {
                if (!id) return;
                setExporting(true);
                // Exactly the rows on screen, in this order — the file should
                // match what was filtered, not the unfiltered cohort.
                reportsApi
                  .exportCohort(
                    id,
                    shown.map((row) => row.sessionId),
                  )
                  .catch((err) =>
                    toast.error(describeError(err, 'Could not export.')),
                  )
                  .finally(() => setExporting(false));
              }}
            >
              {exporting ? 'Preparing…' : `Export ${shown.length} to CSV`}
            </button>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Attempts</h2>
              <span className="badge">
                {shown.length === attempts.length
                  ? attempts.length
                  : `${shown.length} of ${attempts.length}`}
              </span>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th style={{ width: 110 }}>Score</th>
                    <th style={{ width: 120 }}>Standing</th>
                    <th style={{ width: 170 }}>Recommendation</th>
                    <th style={{ width: 90 }}>Signals</th>
                    <th style={{ width: 200 }}>Decision</th>
                    <th style={{ width: 130 }} />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <tr
                      key={row.sessionId}
                      className={
                        row.review?.decision === 'rejected'
                          ? 'cohort-rejected'
                          : ''
                      }
                    >
                      <td>
                        <strong>{row.candidate.fullName}</strong>
                        <div className="muted small">{row.candidate.email}</div>

                        {(row.review?.tags.length ?? 0) > 0 && (
                          <div className="cohort-tags">
                            {row.review!.tags.map((tag) => (
                              <span key={tag} className="cohort-tag">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}

                        {row.review?.note && editing !== row.sessionId && (
                          <p className="cohort-note">
                            {row.review.note}
                            {row.review.updatedBy && (
                              <span className="muted small">
                                {' '}
                                — {row.review.updatedBy}
                              </span>
                            )}
                          </p>
                        )}

                        {editing === row.sessionId && (
                          <div className="cohort-note-edit">
                            <textarea
                              value={draftNote}
                              onChange={(e) => setDraftNote(e.target.value)}
                              rows={3}
                              maxLength={4000}
                              placeholder="Visible to everyone in your workspace"
                              autoFocus
                            />
                            <div className="row">
                              <button
                                type="button"
                                className="primary"
                                disabled={saving === row.sessionId}
                                onClick={() => {
                                  void patch(row.sessionId, {
                                    note: draftNote.trim() || null,
                                  }).then(() => setEditing(null));
                                }}
                              >
                                Save note
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditing(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </td>

                      <td>
                        {row.overallScore === null ? (
                          <span className="muted">—</span>
                        ) : (
                          <>
                            <strong>{row.overallScore}</strong>
                            {/* The split, so a blended figure is never a bare
                                number the recruiter cannot account for. */}
                            <div className="muted small">
                              {row.abilityScore !== null &&
                                `ability ${row.abilityScore}`}
                              {row.abilityScore !== null &&
                                row.behavioralScore !== null &&
                                ' · '}
                              {row.behavioralScore !== null &&
                                `behavioural ${row.behavioralScore}`}
                            </div>
                          </>
                        )}
                      </td>

                      <td>
                        {row.rank === null ? (
                          // Not a zero and not last: an attempt with no score
                          // has no position in the order at all.
                          <span className="muted small">Not yet ranked</span>
                        ) : (
                          <>
                            <strong className="cohort-standing">
                              {ordinal(row.rank)}
                            </strong>
                            {/* The denominator, always — "3rd" reads as a
                                result and "3rd of 3" reads as the truth. */}
                            <div className="muted small">
                              of {row.cohortSize}
                            </div>
                          </>
                        )}
                      </td>

                      <td>
                        {row.hiringRecommendation ? (
                          <span
                            className={`badge ${RECOMMENDATION_BADGE[row.hiringRecommendation]}`}
                          >
                            {RECOMMENDATION_LABEL[row.hiringRecommendation]}
                          </span>
                        ) : (
                          <span className="badge">
                            {row.status === 'in_progress'
                              ? 'in progress'
                              : 'pending'}
                          </span>
                        )}
                        <div className="muted small">
                          {formatDate(row.submittedAt)}
                        </div>
                      </td>

                      <td>
                        {/* Context, never an alarm — the recruiter judges. */}
                        {row.violationCount > 0 ? (
                          row.violationCount
                        ) : (
                          <span className="muted">none</span>
                        )}
                      </td>

                      <td>
                        {/* Frozen once the candidate has been told. Flipping
                            the flag back would not un-read their email, and
                            would leave the workspace showing a state they have
                            good reason to believe is false. Contact is the
                            honest way back — see below. */}
                        {(() => {
                          const told = !!row.review?.rejectionEmailSentAt;
                          const lockNote = told
                            ? 'This candidate has been told they were not successful — the decision cannot be changed. Use Contact candidate.'
                            : undefined;

                          return (
                            <div className="cohort-actions">
                              <button
                                type="button"
                                className={`cohort-pick${
                                  row.review?.decision === 'shortlisted'
                                    ? ' cohort-pick--on'
                                    : ''
                                }`}
                                disabled={told || saving === row.sessionId}
                                title={lockNote}
                                onClick={() => void decide(row, 'shortlisted')}
                              >
                                Shortlist
                              </button>
                              <button
                                type="button"
                                className={`cohort-pick${
                                  row.review?.decision === 'rejected'
                                    ? ' cohort-pick--off'
                                    : ''
                                }`}
                                disabled={told || saving === row.sessionId}
                                title={lockNote}
                                onClick={() => void decide(row, 'rejected')}
                              >
                                Reject
                              </button>
                            </div>
                          );
                        })()}
                        <button
                          type="button"
                          className="link cohort-note-btn"
                          onClick={() => {
                            setEditing(row.sessionId);
                            setDraftNote(row.review?.note ?? '');
                          }}
                        >
                          {row.review?.note ? 'Edit note' : 'Add note'}
                        </button>

                        {/*
                          Rejecting emails the candidate on the click, so this
                          is normally just a record of when. The button only
                          appears where that did not happen — an attempt
                          rejected before the email existed, or one whose send
                          failed — which makes an unsent rejection visible
                          rather than silent.
                        */}
                        {row.review?.decision === 'rejected' &&
                          (row.review.rejectionEmailSentAt ? (
                            <>
                              <span
                                className="cohort-sent"
                                title={`Rejection email sent ${formatWhen(row.review.rejectionEmailSentAt)}`}
                              >
                                Emailed{' '}
                                {formatWhen(row.review.rejectionEmailSentAt)}
                              </span>
                              {/* The way back. Kept on the row rather than
                                  buried in the report, because the moment
                                  somebody changes their mind is while looking
                                  at the list they rejected them from. */}
                              <button
                                type="button"
                                className="link cohort-note-btn"
                                onClick={() => openContact(row)}
                              >
                                Contact candidate
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="link cohort-note-btn"
                              disabled={notifying === row.sessionId}
                              onClick={() => void resendRejection(row)}
                            >
                              {notifying === row.sessionId
                                ? 'Sending…'
                                : 'Not emailed — send now'}
                            </button>
                          ))}
                      </td>

                      <td>
                        {row.status === 'in_progress' ? (
                          <span className="muted small">Still taking it</span>
                        ) : (
                          <Link
                            className="button soft"
                            to={`/admin/reports/${row.sessionId}`}
                          >
                            Open report
                            <IconArrow
                              className="button-go"
                              width={15}
                              height={15}
                            />
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {shown.length === 0 && (
            <div className="card empty" style={{ marginTop: 14 }}>
              Nobody matches that filter.
            </div>
          )}

          {/* Said once, above the table, rather than in a dialog on every
              click. Rejecting sends immediately, so the one thing a recruiter
              must know before their first click is that it does — and the
              place for that is here, not in a confirmation they will dismiss
              without reading by the third row. */}
          <p className="cohort-warn" style={{ marginTop: 14 }}>
            <strong>Rejecting emails the candidate straight away.</strong> The
            message goes out under your company's name, gives no score and no
            reason, and cannot be recalled. Clearing the decision afterwards
            does not unsend it — though nobody is ever emailed twice.
          </p>

          <p className="muted small">
            Decisions, tags and notes are shared with everyone in your
            workspace, and never shown to the candidate.
          </p>
        </>
      )}

      <Modal
        open={contacting !== null}
        title={`Write to ${contacting?.candidate.fullName ?? 'candidate'}`}
        onClose={sendingMessage ? () => undefined : () => setContacting(null)}
        footer={
          <>
            <button
              onClick={() => setContacting(null)}
              disabled={sendingMessage}
            >
              Cancel
            </button>
            <button
              className="primary"
              onClick={() => void sendMessage()}
              disabled={sendingMessage || !draftMessage.trim()}
            >
              {sendingMessage ? 'Sending…' : 'Send message'}
            </button>
          </>
        }
      >
        <p className="muted small" style={{ marginTop: 0 }}>
          Goes to <strong>{contacting?.candidate.email}</strong> under your
          company's name. Replies come back to your support address.
        </p>

        {/* Said plainly, because it is the thing that surprises people: this
            is not the internal note field, and whatever is typed here will be
            read by the candidate exactly as written. */}
        <p className="cohort-warn">
          This is sent <strong>to the candidate</strong>, word for word. It is
          not a note — notes stay inside your workspace.
        </p>

        <div className="field">
          <label htmlFor="contact-body">Your message</label>
          <textarea
            id="contact-body"
            rows={8}
            maxLength={4000}
            value={draftMessage}
            disabled={sendingMessage}
            placeholder={
              'We reviewed your assessment again and would like to talk to you' +
              ' about a role on the platform team. Are you free this week?'
            }
            onChange={(e) => setDraftMessage(e.target.value)}
          />
          <p className="field-note">
            A greeting and your company's sign-off are added automatically —
            write only what you want to say.
          </p>
        </div>

        {/* What has already been said, so a second message does not repeat or
            contradict the first. */}
        {history && history.length > 0 && (
          <div className="cohort-history">
            <h3>Already sent</h3>
            {history.map((message) => (
              <div className="cohort-history-item" key={message.id}>
                <div className="muted small">
                  {formatWhen(message.sentAt)}
                  {message.sentBy && ` · ${message.sentBy}`} · {message.sentTo}
                </div>
                <p>{message.body}</p>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
