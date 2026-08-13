import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { assessmentsApi, reportsApi } from '../../lib/endpoints';
import { describeError } from '../../lib/errors';
import type { AttemptListItem, HiringRecommendation } from '../../lib/types';

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

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

/** Every candidate who has attempted one assessment, and their headline result. */
export function AssessmentReports() {
  const { id } = useParams<{ id: string }>();
  const [title, setTitle] = useState('');
  const [attempts, setAttempts] = useState<AttemptListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        <div className="card">
          <div className="card-head">
            <h2>Attempts</h2>
            <span className="badge">{attempts.length}</span>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th style={{ width: 110 }}>Score</th>
                  <th style={{ width: 180 }}>Recommendation</th>
                  <th style={{ width: 110 }}>Answers</th>
                  <th style={{ width: 100 }}>Signals</th>
                  <th style={{ width: 190 }}>Submitted</th>
                  <th style={{ width: 110 }} />
                </tr>
              </thead>
              <tbody>
                {attempts.map((attempt) => (
                  <tr key={attempt.sessionId}>
                    <td>
                      <strong>{attempt.candidate.fullName}</strong>
                      <div className="muted small">
                        {attempt.candidate.email}
                      </div>
                    </td>
                    <td>
                      {attempt.overallScore === null ? (
                        <span className="muted">—</span>
                      ) : (
                        <>
                          <strong>{attempt.overallScore}</strong>
                          {/* The split, so a blended figure is never a bare
                              number the recruiter cannot account for. */}
                          <div className="muted small">
                            {attempt.abilityScore !== null &&
                              `ability ${attempt.abilityScore}`}
                            {attempt.abilityScore !== null &&
                              attempt.behavioralScore !== null &&
                              ' · '}
                            {attempt.behavioralScore !== null &&
                              `behavioural ${attempt.behavioralScore}`}
                          </div>
                        </>
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
                        <span className="badge">
                          {attempt.status === 'in_progress'
                            ? 'in progress'
                            : 'pending'}
                        </span>
                      )}
                    </td>
                    <td>{attempt.questionsAnswered}</td>
                    <td>
                      {/* Never styled as an alarm — it is context, not a verdict. */}
                      {attempt.violationCount > 0 ? (
                        attempt.violationCount
                      ) : (
                        <span className="muted">none</span>
                      )}
                    </td>
                    <td className="muted small">
                      {formatDate(attempt.submittedAt)}
                    </td>
                    <td>
                      {attempt.status === 'in_progress' ? (
                        <span className="muted small">Still taking it</span>
                      ) : (
                        <Link
                          className="button"
                          to={`/admin/reports/${attempt.sessionId}`}
                        >
                          Open report
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
