import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Modal } from '../../components/Modal';
import { assessmentsApi, invitationsApi } from '../../lib/endpoints';
import { describeError } from '../../lib/errors';
import {
  WINDOW_TONE,
  describeWindow,
  fromLocalInput,
  toLocalInput,
} from '../../lib/schedule';
import type {
  Assessment,
  AssessmentInvitation,
  BulkInviteResult,
} from '../../lib/types';

export function InviteCandidates() {
  const { id = '' } = useParams();
  const inputRef = useRef<HTMLInputElement>(null);

  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [invites, setInvites] = useState<AssessmentInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BulkInviteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Add-one form. Separate busy flag so it doesn't lock out the dropzone.
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  /** Which invitation is mid-remove, so only its own buttons disable. */
  const [pendingId, setPendingId] = useState<string | null>(null);

  /**
   * The invitation whose window is being edited, and the two boxes.
   *
   * Held as `datetime-local` strings — local wall clock, no zone — and
   * converted on save. `lib/schedule.ts` explains why that conversion is not
   * written inline.
   */
  const [rescheduling, setRescheduling] = useState<AssessmentInvitation | null>(
    null,
  );
  const [windowOpens, setWindowOpens] = useState('');
  const [windowCloses, setWindowCloses] = useState('');
  const [savingWindow, setSavingWindow] = useState(false);

  const refreshInvites = async () => {
    setInvites(await invitationsApi.forAssessment(id));
  };

  useEffect(() => {
    Promise.all([assessmentsApi.get(id), invitationsApi.forAssessment(id)])
      .then(([a, list]) => {
        setAssessment(a);
        setInvites(list);
      })
      .catch((err) =>
        setError(describeError(err, 'Could not load this assessment.')),
      )
      .finally(() => setLoading(false));
  }, [id]);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const outcome = await invitationsApi.bulkInvite(id, file);
      setResult(outcome);
      await refreshInvites();
    } catch (err) {
      setError(
        describeError(err, 'The upload failed. Check the file and try again.'),
      );
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void upload(file);
  };

  const addOne = async () => {
    setAdding(true);
    setError(null);
    setAdded(null);

    try {
      const invite = await invitationsApi.inviteOne(id, email, fullName);
      setAdded(`${invite.email} invited.`);
      setEmail('');
      setFullName('');
      await refreshInvites();
    } catch (err) {
      // The API is specific here — "already invited", "that's a recruiter
      // account" — so surface its message rather than a generic one.
      setError(describeError(err, 'Could not invite that candidate.'));
    } finally {
      setAdding(false);
    }
  };

  const removeInvite = async (invite: AssessmentInvitation) => {
    setPendingId(invite.id);
    setError(null);
    setAdded(null);

    try {
      await invitationsApi.remove(invite.id);
      await refreshInvites();
    } catch (err) {
      // A 409 here means they have already started; the message explains that
      // revoking is the way to withdraw access.
      setError(describeError(err, 'Could not remove that invitation.'));
    } finally {
      setPendingId(null);
    }
  };

  const revokeInvite = async (invite: AssessmentInvitation) => {
    setPendingId(invite.id);
    setError(null);
    setAdded(null);

    try {
      await invitationsApi.revoke(invite.id);
      await refreshInvites();
    } catch (err) {
      setError(describeError(err, 'Could not revoke that invitation.'));
    } finally {
      setPendingId(null);
    }
  };

  /**
   * Opens the dialog seeded with the *override*, not the effective window.
   *
   * Showing the round's inherited dates in the boxes would be worse than
   * empty: saving without touching them would silently copy the round's
   * schedule onto this one candidate as a private override, and the next
   * change to the round would then skip them.
   */
  const openReschedule = (invite: AssessmentInvitation) => {
    setRescheduling(invite);
    setWindowOpens(toLocalInput(invite.window?.overrideOpensAt ?? null));
    setWindowCloses(toLocalInput(invite.window?.overrideExpiresAt ?? null));
    setError(null);
    setAdded(null);
  };

  const saveWindow = async () => {
    if (!rescheduling) return;

    const opensAt = fromLocalInput(windowOpens);
    const expiresAt = fromLocalInput(windowCloses);

    setSavingWindow(true);
    setError(null);

    try {
      // Both ends every time, nulls included: an emptied box means "clear this
      // override", and omitting the field would leave the old value in place.
      await invitationsApi.reschedule(rescheduling.id, { opensAt, expiresAt });
      await refreshInvites();
      setAdded(
        opensAt || expiresAt
          ? `${rescheduling.email} now has their own window.`
          : `${rescheduling.email} is back on the round's own dates.`,
      );
      setRescheduling(null);
    } catch (err) {
      // The API names the specific problem — a window that closes before it
      // opens — so pass its message through rather than a generic one.
      setError(describeError(err, 'Could not change that window.'));
    } finally {
      setSavingWindow(false);
    }
  };

  if (loading) return <div className="empty">Loading…</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Invite candidates</h1>
          <p>
            {assessment ? (
              <>
                Uploading to <strong>{assessment.title}</strong>. Each new email
                gets an invitation to register and take this assessment.
              </>
            ) : (
              'Assessment'
            )}
          </p>
        </div>
        <Link className="button" to="/admin/assessments">
          ← All assessments
        </Link>
      </div>

      {error && <div className="alert error">{error}</div>}
      {added && <div className="alert success">{added}</div>}

      <div className="stack">
        {/*
         * Listed before the dropzone: adding one or two people is the common
         * case, and it should not look like the fallback for the upload.
         */}
        <div className="card card-pad">
          <h2>Add a candidate</h2>
          <p className="muted small" style={{ margin: '3px 0 12px' }}>
            For one or two people. They get the same invitation email as an
            upload — no spreadsheet needed.
          </p>

          <form
            className="row"
            onSubmit={(event) => {
              event.preventDefault();
              if (email.trim() && !adding) void addOne();
            }}
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="candidate@example.com"
              aria-label="Candidate email"
              maxLength={255}
              required
              style={{ flex: 2, minWidth: 220 }}
            />
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Name (optional)"
              aria-label="Candidate name"
              maxLength={200}
              style={{ flex: 1, minWidth: 160 }}
            />
            <button className="primary" type="submit" disabled={adding}>
              {adding ? 'Inviting…' : 'Send invitation'}
            </button>
          </form>
        </div>

        <div
          className={`dropzone ${dragging ? 'over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xlsm,.txt"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = '';
            }}
          />
          <strong>
            {busy ? 'Sending invitations…' : 'Drop a candidate sheet here'}
          </strong>
          <span className="muted small">
            or click to browse — columns: name, email · .csv or .xlsx
          </span>
        </div>

        <div className="card card-pad">
          <div className="spread">
            <div>
              <h2>Not sure about the columns?</h2>
              <p className="muted small" style={{ margin: '3px 0 0' }}>
                Download a starter sheet with the exact headers.
              </p>
            </div>
            <button onClick={() => void invitationsApi.downloadTemplate()}>
              Candidate template
            </button>
          </div>
        </div>

        {result && (
          <div className="card">
            <div className="card-head">
              <h2>Upload result</h2>
              <span
                className={`badge ${result.failed === 0 ? 'active' : 'draft'}`}
              >
                {result.invited} invited
              </span>
            </div>
            <div className="card-pad">
              <div className="grid">
                <div className="stat">
                  <div className="label">Rows read</div>
                  <div className="value">{result.totalRows}</div>
                </div>
                <div className="stat">
                  <div className="label">Invited</div>
                  <div className="value" style={{ color: 'var(--success)' }}>
                    {result.invited}
                  </div>
                  <div className="sub">emails queued</div>
                </div>
                <div className="stat">
                  <div className="label">Skipped</div>
                  <div className="value">{result.skipped}</div>
                  <div className="sub">already invited</div>
                </div>
                <div className="stat">
                  <div className="label">Failed</div>
                  <div
                    className="value"
                    style={{
                      color: result.failed ? 'var(--danger)' : undefined,
                    }}
                  >
                    {result.failed}
                  </div>
                </div>
              </div>
            </div>

            {result.failures.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 90 }}>Sheet row</th>
                      <th>Email</th>
                      <th>Why it was skipped</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.failures.map((f) => (
                      <tr key={`${f.row}-${f.email ?? ''}`}>
                        <td className="mono">{f.row}</td>
                        <td className="muted">{f.email ?? '—'}</td>
                        <td style={{ color: 'var(--danger)' }}>{f.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div className="card">
          <div className="card-head">
            <h2>Invited candidates</h2>
            <span className="badge">{invites.length}</span>
          </div>

          {invites.length === 0 ? (
            <div className="card-pad muted">
              No one invited yet — add a candidate or upload a sheet above.
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th style={{ width: 160 }}>Registered</th>
                    <th style={{ width: 130 }}>Status</th>
                    <th style={{ width: 200 }}>Can sit</th>
                    <th style={{ width: 190 }} />
                  </tr>
                </thead>
                <tbody>
                  {invites.map((invite) => {
                    // Once they have started, the attempt references the
                    // invitation — withdrawing access is a revoke, not a
                    // delete, and offering "Remove" there would only 409.
                    const started = invite.status !== 'pending';
                    const busyRow = pendingId === invite.id;

                    return (
                      <tr key={invite.id}>
                        <td>{invite.email}</td>
                        <td>
                          {invite.registered ? (
                            <span className="badge active">
                              {invite.candidateName ?? 'Yes'}
                            </span>
                          ) : (
                            <span className="muted small">Not yet</span>
                          )}
                        </td>
                        <td>
                          <span className="badge">{invite.status}</span>
                        </td>
                        <td>
                          {invite.window ? (
                            <div className="inv-window">
                              <span
                                className={`ci-pill ci-pill--${WINDOW_TONE[invite.window.state]}`}
                              >
                                {invite.window.state === 'open'
                                  ? 'Open'
                                  : invite.window.state === 'not_yet'
                                    ? 'Not yet'
                                    : 'Closed'}
                              </span>
                              {/* Null when the window is open and unbounded —
                                  "no deadline" is not worth a line. */}
                              {describeWindow(invite.window, 'recruiter') && (
                                <span className="muted small">
                                  {describeWindow(invite.window, 'recruiter')}
                                </span>
                              )}
                              {(invite.window.overrideOpensAt ||
                                invite.window.overrideExpiresAt) && (
                                <span
                                  className="badge accent"
                                  title="This candidate has their own dates, separate from the round"
                                >
                                  Rescheduled
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="muted small">—</span>
                          )}
                        </td>
                        <td className="inv-actions">
                          {/* Offered even after they have started: the window
                              is only checked on the way in, so moving it can
                              never interrupt an attempt already running. It is
                              also exactly when it is needed — the candidate
                              whose power went is by definition one who
                              started. */}
                          {invite.status !== 'revoked' && (
                            <button
                              type="button"
                              className="link"
                              disabled={busyRow}
                              onClick={() => openReschedule(invite)}
                            >
                              Reschedule
                            </button>
                          )}
                          {invite.status === 'revoked' ? (
                            <span className="muted small">Withdrawn</span>
                          ) : started ? (
                            <button
                              type="button"
                              className="link danger-link"
                              disabled={busyRow}
                              onClick={() => void revokeInvite(invite)}
                            >
                              {busyRow ? 'Revoking…' : 'Revoke'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="link danger-link"
                              disabled={busyRow}
                              onClick={() => void removeInvite(invite)}
                            >
                              {busyRow ? 'Removing…' : 'Remove'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={rescheduling !== null}
        title="Reschedule this candidate"
        onClose={savingWindow ? () => undefined : () => setRescheduling(null)}
        footer={
          <>
            <button
              onClick={() => setRescheduling(null)}
              disabled={savingWindow}
            >
              Cancel
            </button>
            <button
              className="primary"
              onClick={() => void saveWindow()}
              disabled={savingWindow}
            >
              {savingWindow ? 'Saving…' : 'Save window'}
            </button>
          </>
        }
      >
        <p className="muted small" style={{ marginTop: 0 }}>
          {rescheduling?.email} only. Everyone else stays on the round's own
          dates.
        </p>

        <div className="field">
          <label htmlFor="resched-opens">Opens</label>
          <input
            id="resched-opens"
            type="datetime-local"
            value={windowOpens}
            disabled={savingWindow}
            onChange={(e) => setWindowOpens(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="resched-closes">Closes</label>
          <input
            id="resched-closes"
            type="datetime-local"
            value={windowCloses}
            disabled={savingWindow}
            onChange={(e) => setWindowCloses(e.target.value)}
          />
        </div>

        <p className="field-note">
          Empty means inherit that end from the round — clearing both puts them
          back on its schedule. Times are in your own timezone.
        </p>

        {/* Said plainly because it is the question a recruiter reaching for
            this button is actually asking. The window governs whether they can
            start, and one invitation allows one attempt: moving the dates for
            somebody who already submitted will not let them sit it again. */}
        <p className="field-note">
          This controls when they can <em>start</em>. Someone who has already
          submitted an attempt cannot re-sit it by moving these dates.
        </p>
      </Modal>
    </>
  );
}
