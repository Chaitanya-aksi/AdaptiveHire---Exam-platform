import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { IconArrow } from '../../components/Icons';
import { SubNav } from '../../components/SubNav';
import { reportsApi } from '../../lib/endpoints';
import { describeError } from '../../lib/errors';
import { formatWhen } from '../../lib/schedule';
import { ASSESSMENT_TABS } from './section-tabs';
import {
  RECOMMENDATION_BADGE,
  RECOMMENDATION_LABEL,
} from './AssessmentReports';
import type { OrgAttemptListItem } from '../../lib/types';

/**
 * Every candidate report in the workspace, newest first.
 *
 * The counterpart to `AssessmentReports`, not a replacement for it. That page is
 * where a *cohort* is worked through — standing, shortlisting, rejection emails
 * and the CSV all need one assessment's worth of comparable attempts to mean
 * anything. This page answers the other question: what has come in lately,
 * across everything we are running.
 *
 * Which is why there is no Standing column here and no shortlist buttons. A
 * position drawn across different assessments would compare people who sat
 * different papers, and a decision taken without the cohort in front of you is
 * a decision taken without the thing that gives a score its meaning.
 */

/** Ordered newest first; "no date" always sorts last. */
function byRecency(a: OrgAttemptListItem, b: OrgAttemptListItem): number {
  return Date.parse(b.startedAt) - Date.parse(a.startedAt);
}

function scoreCell(row: OrgAttemptListItem) {
  if (row.overallScore === null) {
    return <span className="muted">—</span>;
  }
  return (
    <>
      <strong>{row.overallScore}</strong>
      {/* The split, so a blended figure is never a number the recruiter
          cannot account for — same rule as the cohort table. */}
      <div className="muted small">
        {row.abilityScore !== null && `ability ${row.abilityScore}`}
        {row.abilityScore !== null && row.behavioralScore !== null && ' · '}
        {row.behavioralScore !== null && `behavioural ${row.behavioralScore}`}
      </div>
    </>
  );
}

export function AllReports() {
  const [attempts, setAttempts] = useState<OrgAttemptListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assessmentId, setAssessmentId] = useState('');
  const [search, setSearch] = useState('');
  /** Hides attempts still being taken, which have nothing to read yet. */
  const [finishedOnly, setFinishedOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;

    reportsApi
      .allAttempts()
      .then((rows) => {
        if (!cancelled) setAttempts(rows);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(describeError(err, 'Could not load reports.'));
        setAttempts([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * The filter's options come from the attempts themselves rather than from the
   * assessment list. An assessment nobody has sat has no reports to filter down
   * to, so offering it would only ever produce an empty table.
   */
  const assessments = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of attempts ?? [])
      seen.set(row.assessment.id, row.assessment.title);
    return [...seen].map(([id, title]) => ({ id, title }));
  }, [attempts]);

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();

    return (attempts ?? [])
      .filter((row) => {
        if (assessmentId && row.assessment.id !== assessmentId) return false;
        if (finishedOnly && row.status === 'in_progress') return false;
        if (!term) return true;
        return (
          row.candidate.fullName.toLowerCase().includes(term) ||
          row.candidate.email.toLowerCase().includes(term) ||
          row.assessment.title.toLowerCase().includes(term)
        );
      })
      .sort(byRecency);
  }, [attempts, assessmentId, finishedOnly, search]);

  const loaded = attempts !== null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Assessments</h1>
          <p>
            Every attempt across your workspace, most recent first. Open one for
            the full report — scores, behavioural profile, every answer and
            every proctoring signal.
          </p>
          <SubNav items={ASSESSMENT_TABS} />
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {!loaded ? (
        <div className="empty">Loading…</div>
      ) : attempts.length === 0 ? (
        <div className="card empty">
          Nobody has sat an assessment yet. Reports appear here as candidates
          finish — <Link to="/admin/assessments">invite someone</Link> to get
          started.
        </div>
      ) : (
        <>
          <div className="toolbar">
            <input
              className="search"
              placeholder="Search name, email or assessment"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <select
              value={assessmentId}
              onChange={(e) => setAssessmentId(e.target.value)}
              aria-label="Filter by assessment"
            >
              <option value="">All assessments ({attempts.length})</option>
              {assessments.map((assessment) => (
                <option key={assessment.id} value={assessment.id}>
                  {assessment.title}
                </option>
              ))}
            </select>

            <label className="ia-toggle">
              <input
                type="checkbox"
                checked={finishedOnly}
                onChange={(e) => setFinishedOnly(e.target.checked)}
              />
              Finished attempts only
            </label>

            <span className="muted small">
              {shown.length === attempts.length
                ? `${attempts.length} attempt${attempts.length === 1 ? '' : 's'}`
                : `${shown.length} of ${attempts.length}`}
            </span>
          </div>

          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Assessment</th>
                    <th style={{ width: 110 }}>Score</th>
                    <th style={{ width: 170 }}>Recommendation</th>
                    <th style={{ width: 90 }}>Signals</th>
                    <th style={{ width: 150 }}>Started</th>
                    <th style={{ width: 130 }} />
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={7} className="empty">
                        Nothing matches that filter.
                      </td>
                    </tr>
                  )}

                  {shown.map((row) => (
                    <tr key={row.sessionId}>
                      <td>
                        <strong>{row.candidate.fullName}</strong>
                        <div className="muted small">{row.candidate.email}</div>
                      </td>

                      <td>
                        {/* Straight to that assessment's cohort, because the
                            question after "who is this" is nearly always "how
                            do they compare with the others who sat it". */}
                        <Link
                          to={`/admin/assessments/${row.assessment.id}/results`}
                        >
                          {row.assessment.title}
                        </Link>
                      </td>

                      <td>{scoreCell(row)}</td>

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
                        {row.review?.decision && (
                          <div className="muted small">
                            {row.review.decision === 'shortlisted'
                              ? 'Shortlisted'
                              : 'Rejected'}
                          </div>
                        )}
                      </td>

                      <td>
                        {/* Context, never an alarm — the recruiter judges. */}
                        {row.violationCount > 0 ? (
                          <Link to="/admin/proctoring" title="What these mean">
                            {row.violationCount}
                          </Link>
                        ) : (
                          <span className="muted">none</span>
                        )}
                      </td>

                      <td className="muted small">
                        {formatWhen(row.startedAt)}
                        {row.submittedAt && (
                          <div>finished {formatWhen(row.submittedAt)}</div>
                        )}
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

          <p className="muted small">
            Shortlisting, rejection and the CSV export live on each assessment's
            own results page — a decision belongs beside the cohort that gives
            the score its meaning.
          </p>
        </>
      )}
    </>
  );
}
