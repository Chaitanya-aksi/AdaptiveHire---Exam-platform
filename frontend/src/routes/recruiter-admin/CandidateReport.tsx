import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { reportsApi } from '../../lib/endpoints';
import { describeError } from '../../lib/errors';
import type {
  ProctoringEventType,
  ReportDetail,
  ReportModuleSummary,
  ReportSummary,
} from '../../lib/types';
import {
  RECOMMENDATION_BADGE,
  RECOMMENDATION_LABEL,
} from './AssessmentReports';

const EVENT_LABEL: Record<ProctoringEventType, string> = {
  tab_switch: 'Switched away from the test',
  fullscreen_exit: 'Left full screen',
  face_absent: 'No face visible',
  multiple_faces: 'More than one face visible',
  multiple_displays_detected: 'More than one display detected',
};

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** A 0-100 score as a bar, so a profile is scannable at a glance. */
function ScoreBar({ score }: { score: number }) {
  return (
    <div className="report-bar" aria-hidden="true">
      <span style={{ width: `${Math.min(100, Math.max(0, score))}%` }} />
    </div>
  );
}

function ModuleCard({ module }: { module: ReportModuleSummary }) {
  return (
    <div className="report-module">
      <div className="spread">
        <div>
          <strong>{module.name}</strong>
          <div className="muted small">
            {module.questionsAnswered} answered
            {module.scoringType === 'objective' &&
              ` · ${module.questionsCorrect} correct`}
            {module.questionsAnswered > 0 &&
              module.questionsAnswered < module.minQuestions &&
              ` · below the ${module.minQuestions} this section asks for`}
          </div>
        </div>
        {module.score !== null && (
          <strong className="report-score">{module.score}</strong>
        )}
      </div>

      {module.score !== null && <ScoreBar score={module.score} />}

      {module.traits.length > 0 && (
        <ul className="report-traits">
          {module.traits.map((trait) => (
            <li key={trait.key}>
              <div className="spread">
                <span>{trait.label}</span>
                <span className="muted small">
                  {trait.score}
                  {/* Low confidence is shown, never silently hidden — a thin
                      trait must not read like a firm finding. */}
                  {trait.confidence < 0.5 && ' · low confidence'}
                </span>
              </div>
              <ScoreBar score={trait.score} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The two-layer report. The summary paints immediately from `reports`; the
 * per-question and per-event detail is fetched separately because it is
 * queried live rather than stored.
 */
export function CandidateReport() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    reportsApi
      .summary(sessionId)
      .then(setSummary)
      .catch((err) => setError(describeError(err, 'Could not load the report.')))
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => {
    if (!showDetail || detail || !sessionId) return;

    reportsApi
      .detail(sessionId)
      .then(setDetail)
      .catch((err) =>
        setError(describeError(err, 'Could not load the detail view.')),
      );
  }, [showDetail, detail, sessionId]);

  if (loading) return <div className="empty">Loading report…</div>;
  if (error && !summary) return <div className="alert error">{error}</div>;
  if (!summary) return null;

  const { report, candidate } = summary;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{candidate.fullName}</h1>
          <p>
            {summary.assessment.title} · {candidate.email}
          </p>
        </div>
        <Link to={`/admin/assessments/${summary.assessment.id}/results`}>
          Back to results
        </Link>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="stack">
        <div className="card card-pad report-head">
          <div className="report-headline">
            <div>
              <span className="muted small">Overall score</span>
              <div className="report-overall">
                {report.overallScore ?? '—'}
                {report.overallScore !== null && (
                  <span className="muted"> / 100</span>
                )}
              </div>
            </div>
            <span
              className={`badge ${RECOMMENDATION_BADGE[report.hiringRecommendation]}`}
            >
              {RECOMMENDATION_LABEL[report.hiringRecommendation]}
            </span>
          </div>

          <p className="report-summary">{report.summary}</p>

          <p className="muted small" style={{ margin: 0 }}>
            Rule-based from the scores below. Proctoring signals never affect
            it — the decision is yours.
          </p>
        </div>

        <div className="grid report-grid">
          <div className="card card-pad">
            <h2>Strengths</h2>
            {report.strengths.length === 0 ? (
              <p className="muted small">Nothing scored highly enough.</p>
            ) : (
              <ul className="report-list">
                {report.strengths.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="card card-pad">
            <h2>Weaknesses</h2>
            {report.weaknesses.length === 0 ? (
              <p className="muted small">Nothing scored low enough.</p>
            ) : (
              <ul className="report-list">
                {report.weaknesses.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="card card-pad stack">
          <h2>Section breakdown</h2>
          {summary.modules.map((module) => (
            <ModuleCard key={module.moduleId} module={module} />
          ))}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Full detail</h2>
            <button
              type="button"
              className="link"
              onClick={() => setShowDetail((open) => !open)}
            >
              {showDetail ? 'Hide' : 'Show every answer and event'}
            </button>
          </div>

          {showDetail &&
            (detail === null ? (
              <div className="card-pad muted">Loading detail…</div>
            ) : (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}>#</th>
                        <th style={{ width: 130 }}>Section</th>
                        <th>Question</th>
                        <th style={{ width: 150 }}>Answer</th>
                        <th style={{ width: 90 }}>Result</th>
                        <th style={{ width: 80 }}>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.answers.map((answer) => (
                        <tr key={answer.sequenceNumber}>
                          <td className="muted">{answer.sequenceNumber}</td>
                          <td className="muted small">{answer.moduleName}</td>
                          <td>{answer.questionText}</td>
                          <td className="small">
                            {answer.selectedOption ? (
                              <>
                                <strong>{answer.selectedOption}</strong>
                                {answer.selectedOptionText &&
                                  ` — ${answer.selectedOptionText}`}
                              </>
                            ) : (
                              <span className="muted">
                                Unanswered — time ran out
                              </span>
                            )}
                          </td>
                          <td>
                            {answer.isCorrect === null ? (
                              <span className="muted small">n/a</span>
                            ) : answer.isCorrect ? (
                              <span className="badge active">Correct</span>
                            ) : (
                              <span className="badge archived">
                                Wrong
                                {answer.correctOption &&
                                  ` (${answer.correctOption})`}
                              </span>
                            )}
                          </td>
                          <td className="muted small">
                            {formatDuration(answer.timeTakenMs)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="card-head">
                  <h3>Proctoring events</h3>
                  <span className="badge">{detail.events.length}</span>
                </div>

                {detail.events.length === 0 ? (
                  <div className="card-pad muted small">
                    Nothing was recorded during this attempt.
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th style={{ width: 200 }}>When</th>
                          <th>Event</th>
                          <th style={{ width: 160 }}>Context</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.events.map((event) => (
                          <tr key={`${event.eventType}-${event.occurredAt}`}>
                            <td className="muted small">
                              {new Date(event.occurredAt).toLocaleString()}
                            </td>
                            <td>{EVENT_LABEL[event.eventType]}</td>
                            <td className="muted small mono">
                              {event.metadata
                                ? JSON.stringify(event.metadata)
                                : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ))}
        </div>
      </div>
    </>
  );
}
