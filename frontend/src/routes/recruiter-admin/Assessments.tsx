import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  IconArrow,
  IconAssessment,
  IconClock,
  IconModules,
  IconTrash,
} from '../../components/Icons';
import { Modal } from '../../components/Modal';
import { SubNav } from '../../components/SubNav';
import { useToast } from '../../components/Toast';
import { assessmentsApi } from '../../lib/endpoints';
import { describeError } from '../../lib/errors';
import { formatWhen } from '../../lib/schedule';
import { ASSESSMENT_TABS } from './section-tabs';
import type { Assessment } from '../../lib/types';

/*
 * Every assessment this workspace has built.
 *
 * A list, and only a list. The creation form used to sit on top of it, so the
 * page a recruiter opens forty times to reach a set of results led with a long
 * form they need once — it now lives at `assessments/new`. What is left can be
 * scanned, which is what a list is for.
 */

/** What the round is doing right now, from its window alone. */
type Phase = 'open' | 'scheduled' | 'closed';

function phaseOf(assessment: Assessment): Phase {
  const now = Date.now();
  if (assessment.opensAt && Date.parse(assessment.opensAt) > now) {
    return 'scheduled';
  }
  if (assessment.closesAt && Date.parse(assessment.closesAt) < now) {
    return 'closed';
  }
  return 'open';
}

const PHASE_LABEL: Record<Phase, string> = {
  open: 'Open',
  scheduled: 'Scheduled',
  closed: 'Closed',
};

export function Assessments() {
  const toast = useToast();

  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  /** The assessment the delete dialog is asking about. */
  const [pendingDelete, setPendingDelete] = useState<Assessment | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = () =>
    assessmentsApi
      .list()
      .then(setAssessments)
      .catch((err) =>
        setError(describeError(err, 'Could not load assessments.')),
      );

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, []);

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return assessments;

    return assessments.filter(
      (a) =>
        a.title.toLowerCase().includes(term) ||
        (a.description ?? '').toLowerCase().includes(term) ||
        a.modules.some((m) => m.module?.name.toLowerCase().includes(term)),
    );
  }, [assessments, search]);

  /**
   * Deleting an assessment deletes every attempt at it, which is why the
   * dialog says so — the answers and reports of everyone who sat it go too.
   */
  const confirmDelete = async () => {
    if (!pendingDelete) return;

    setDeleting(true);
    try {
      const result = await assessmentsApi.remove(pendingDelete.id);
      toast.success(
        `"${pendingDelete.title}" deleted, with ${result.sessions} attempt${
          result.sessions === 1 ? '' : 's'
        } and ${result.invitations} invitation${
          result.invitations === 1 ? '' : 's'
        }.`,
      );
      setPendingDelete(null);
      void load();
    } catch (err) {
      toast.error(describeError(err, 'Could not delete this assessment.'));
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <div className="empty">Loading…</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Assessments</h1>
          <p>Every round this workspace has built.</p>
          <SubNav items={ASSESSMENT_TABS} />
        </div>
        <Link className="button primary" to="/admin/assessments/new">
          New assessment
        </Link>
      </div>

      {error && <div className="alert error">{error}</div>}

      {assessments.length === 0 ? (
        /* An empty state that says what to do, rather than a card with a
           count of zero in it. */
        <div className="card card-pad al-empty">
          <IconAssessment width={26} height={26} />
          <h2>No assessments yet</h2>
          <p className="muted">
            An assessment is a set of subjects with a time limit. Build one,
            then invite candidates to sit it.
          </p>
          <Link className="button primary" to="/admin/assessments/new">
            Create your first assessment
            <IconArrow />
          </Link>
        </div>
      ) : (
        <div className="card">
          <div className="card-head al-list-head">
            <input
              className="al-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title, description or subject"
              aria-label="Search assessments"
            />
            <span className="badge">
              {shown.length === assessments.length
                ? assessments.length
                : `${shown.length} of ${assessments.length}`}
            </span>
          </div>

          {shown.length === 0 ? (
            <div className="card-pad muted">Nothing matches that search.</div>
          ) : (
            <ul className="a-list">
              {shown.map((a) => {
                // The three things a recruiter actually wants to know at a
                // glance about a test they built.
                const names = a.modules
                  .map((m) => m.module?.name)
                  .filter((n): n is string => Boolean(n));
                const minQ = a.modules.reduce((t, m) => t + m.questionCount, 0);
                const maxQ = a.modules.reduce((t, m) => t + m.questionCount, 0);
                const minutes = Math.round(
                  a.modules.reduce((t, m) => t + m.timeLimitSeconds, 0) / 60,
                );
                const curated = a.questionPool.length > 0;
                const phase = phaseOf(a);

                return (
                  <li key={a.id} className="a-row">
                    <div className="a-main">
                      <div className="a-title-line">
                        {/*
                          One real link per row, stretched over the whole row by
                          `.a-title::after`. An onClick on the <li> would have
                          been fewer lines but is not a link: no keyboard focus,
                          no middle-click, no "open in new tab", nothing for a
                          screen reader to announce. The action buttons sit above
                          the overlay so they still work.
                        */}
                        <Link
                          className="a-title"
                          to={`/admin/assessments/${a.id}`}
                        >
                          {a.title}
                          <IconArrow className="a-go" width={15} height={15} />
                        </Link>
                        {/* Only when it says something. "Open" is the normal
                            state and every row would carry it. */}
                        {phase !== 'open' && (
                          <span className={`badge al-${phase}`}>
                            {PHASE_LABEL[phase]}
                          </span>
                        )}
                        {curated && (
                          <span
                            className="badge accent"
                            title={`The engine may only draw from ${a.questionPool.length} chosen questions`}
                          >
                            Curated
                          </span>
                        )}
                      </div>

                      {a.description && (
                        <p className="a-desc muted">{a.description}</p>
                      )}

                      <div className="a-meta">
                        <span title="Subjects in this assessment">
                          <IconModules width={14} height={14} />
                          {names.length > 0
                            ? names.join(' · ')
                            : `${a.modules.length} module${a.modules.length === 1 ? '' : 's'}`}
                        </span>
                        <span title="Questions this assessment can ask">
                          <IconAssessment width={14} height={14} />
                          {/* A range, not a number: the test is adaptive, so
                              two candidates rarely answer the same count. */}
                          {minQ === maxQ ? minQ : `${minQ}–${maxQ}`} questions
                        </span>
                        <span title="Total time limit across every module">
                          <IconClock width={14} height={14} />
                          {minutes} min
                        </span>
                        {/* Only when there is a bound to state. Most rounds
                            have none, and "always open" is not news. */}
                        {(a.opensAt || a.closesAt) && (
                          <span title="When candidates can sit this round">
                            <IconClock width={14} height={14} />
                            {a.opensAt && a.closesAt
                              ? `${formatWhen(a.opensAt)} → ${formatWhen(a.closesAt)}`
                              : a.opensAt
                                ? `From ${formatWhen(a.opensAt)}`
                                : `Until ${formatWhen(a.closesAt)}`}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="a-actions">
                      <Link
                        className="button"
                        to={`/admin/assessments/${a.id}/questions`}
                        title={
                          curated
                            ? `Restricted to ${a.questionPool.length} questions`
                            : 'Drawing on every question you can see'
                        }
                      >
                        Questions
                        {curated && ` (${a.questionPool.length})`}
                      </Link>
                      <Link
                        className="button"
                        to={`/admin/assessments/${a.id}/invite`}
                      >
                        Invite
                      </Link>
                      <Link
                        className="button primary"
                        to={`/admin/assessments/${a.id}/results`}
                      >
                        Results
                      </Link>
                      {/* Icon-only and last: destructive, so it should not
                          compete with the three things you came here to do.
                          Labelled for screen readers, since it has no text. */}
                      <button
                        className="icon-button destructive"
                        onClick={() => setPendingDelete(a)}
                        title="Delete assessment"
                        aria-label={`Delete ${a.title}`}
                      >
                        <IconTrash width={17} height={17} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/*
        Deliberately explicit about the blast radius. This is the one action in
        the product that destroys other people's work: everyone who sat this
        assessment loses their answers, their score and their report. The
        candidates themselves keep their accounts — only this assessment's data
        goes — because someone who sat three of your tests should not disappear
        along with one of them.
      */}
      <Modal
        open={pendingDelete !== null}
        title="Delete this assessment?"
        onClose={() => {
          if (!deleting) setPendingDelete(null);
        }}
        footer={
          <>
            <button onClick={() => setPendingDelete(null)} disabled={deleting}>
              Cancel
            </button>
            <button
              className="danger"
              onClick={() => void confirmDelete()}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete permanently'}
            </button>
          </>
        }
      >
        {pendingDelete && (
          <>
            <p style={{ marginTop: 0 }}>
              <strong>{pendingDelete.title}</strong>
            </p>
            <p>
              Every attempt made on this assessment is destroyed with it — each
              candidate&rsquo;s answers, ability scores, behavioural profile,
              report and proctoring log — along with every invitation to it.
            </p>
            <p className="muted small" style={{ marginBottom: 0 }}>
              The candidates keep their accounts and anything they did on your
              other assessments. This cannot be undone.
            </p>
          </>
        )}
      </Modal>
    </>
  );
}
