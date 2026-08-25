import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { reportsApi } from '../../lib/endpoints';
import { describeError } from '../../lib/errors';
// Aliased: this file already has a `formatDuration` that takes milliseconds,
// for the per-question times in the answer table. This one takes seconds, and
// two functions with the same name and different units is a bug waiting to be
// written.
import {
  formatDuration as formatSeconds,
  formatWhen as formatMoment,
} from '../../lib/schedule';
import type {
  AnswerDetail,
  BehavioralPattern,
  ProbeAnswerLink,
  ProbeSummary,
  ProctoringEventType,
  ProfileBand,
  ProfileScore,
  ReportDetail,
  ReportModuleSummary,
  ReportSummary,
} from '../../lib/types';
import {
  RECOMMENDATION_BADGE,
  RECOMMENDATION_LABEL,
} from './AssessmentReports';

const PATTERN_LABEL: Record<BehavioralPattern, string> = {
  situational: 'situational',
  forced_choice: 'forced choice',
  trade_off: 'trade-off',
  ranking: 'ranking',
};

/**
 * Agreement at or above which a repeat probe counts as having held. Mirrors the
 * backend's `CONSISTENT_AT`, which words the same call in the narrative.
 */
const PROBE_HELD_AT = 0.7;

/**
 * Evidence at or above which a trait is reported as a figure at all. Mirrors
 * the backend's `MIN_TRAIT_CONFIDENCE`, which is the same floor the server
 * applies when it decides whether a composite carries a score.
 */
const MIN_TRAIT_CONFIDENCE = 0.5;

const BAND_LABEL: Record<ProfileBand, string> = {
  strong: 'Strong',
  moderate: 'Moderate',
  developing: 'Developing',
};

/** Reuses the recommendation badge palette so bands read consistently. */
const BAND_BADGE: Record<ProfileBand, string> = {
  strong: 'active',
  moderate: '',
  developing: 'archived',
};

const EVENT_LABEL: Record<ProctoringEventType, string> = {
  tab_switch: 'Switched away from the test',
  fullscreen_exit: 'Left full screen',
  face_absent: 'No face visible',
  face_not_framed: 'Face not properly in view',
  multiple_faces: 'More than one face visible',
  multiple_displays_detected: 'More than one display detected',
  background_noise: 'Background noise',
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

/**
 * The repeat probes for one section: how many pairs were checked, and what each
 * one showed.
 *
 * The mechanism is spelled out rather than reduced to a percentage. "The same
 * question came back reworded eight questions later" is something a recruiter
 * can reason about; "agreement 50%" on its own is not, and would invite them to
 * read it as a truthfulness score, which it is not.
 */
function ProbeBlock({ probes }: { probes: ProbeSummary }) {
  const checked = probes.pairs.filter((pair) => pair.agreement !== null);
  const held = checked.filter((pair) => (pair.agreement ?? 0) >= PROBE_HELD_AT);

  return (
    <div className="report-probes">
      <div className="spread">
        <span className="small">
          <strong>Repeat check</strong>
          <span className="muted">
            {' '}
            · the same question again later, reworded, with reordered options
          </span>
        </span>
        {checked.length > 0 && (
          <span className="muted small">
            {held.length} of {checked.length} held
          </span>
        )}
      </div>

      {checked.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>
          A repeat was set up but the section ended before it came round, so
          there is nothing to compare.
        </p>
      ) : (
        <ul className="report-probe-list">
          {checked.map((pair) => {
            const agreement = pair.agreement ?? 0;
            const consistent = agreement >= PROBE_HELD_AT;

            return (
              <li key={pair.firstSequence}>
                <span className="muted small mono">
                  Q{pair.firstSequence} → Q{pair.secondSequence}
                </span>{' '}
                <span className={`badge ${consistent ? 'active' : 'archived'}`}>
                  {consistent ? 'Same answer' : 'Answered differently'}
                </span>
                {pair.flipped === true && (
                  <span className="muted small">
                    {' '}
                    · right one time, wrong the other
                  </span>
                )}
                {pair.divergentTraits.length > 0 && (
                  <span className="muted small">
                    {' '}
                    ·{' '}
                    {pair.divergentTraits
                      .slice(0, 3)
                      .map(
                        (t) =>
                          `${t.label} ${signed(t.first)} then ${signed(t.second)}`,
                      )
                      .join(', ')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Stated every time, because this is the figure most likely to be
          mistaken for a lie-detector reading. */}
      <p className="muted small" style={{ margin: 0 }}>
        Answering differently is not proof of anything on its own — both answers
        are in the detail view below.
      </p>
    </div>
  );
}

/** `+3` / `-3`, so the direction of a trait weight is unmistakable. */
function signed(weight: number): string {
  return weight > 0 ? `+${weight}` : String(weight);
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
              module.questionsAnswered < module.questionCount &&
              ` · below the ${module.questionCount} this section asks for`}
          </div>
        </div>
        {module.score !== null && (
          <strong className="report-score">{module.score}</strong>
        )}
      </div>

      {module.score !== null && <ScoreBar score={module.score} />}

      {/* Scored before the trait vocabulary changed. The numbers are real, but
          they measure different things than today's traits, so they are shown
          under their original names with the mismatch stated. */}
      {module.legacyTraitModel && (
        <p className="muted small" style={{ margin: 0 }}>
          Measured against a previous trait model — these names and scores
          aren&rsquo;t comparable with more recent attempts.
        </p>
      )}

      {module.consistency !== null && (
        <div className="spread report-consistency">
          <span className="muted small">
            Consistency across situations
            <span className="muted small">
              {' '}
              · how steadily each trait showed up, not a truthfulness check
            </span>
          </span>
          <span className="muted small">
            {Math.round(module.consistency * 100)}%
          </span>
        </div>
      )}

      {module.probes && <ProbeBlock probes={module.probes} />}

      {module.traits.length > 0 && (
        <ul className="report-traits">
          {module.traits.map((trait) => {
            /*
             * Same rule as the composites above: below the floor, no number and
             * no bar.
             *
             * Two distinct cases, and calling them both "low confidence" was
             * wrong. A trait with `confidence: 0` was never asked about at all
             * — the estimator scores it at the neutral midpoint so the report
             * can say "no signal" — so rendering "50" with a half-filled bar
             * invented a measurement. A trait with one or two answers was
             * measured, just not enough to report.
             */
            const answered = trait.confidence > 0;
            const measured = trait.confidence >= MIN_TRAIT_CONFIDENCE;

            return (
              <li key={trait.key}>
                <div className="spread">
                  <span className={measured ? undefined : 'muted'}>
                    {trait.label}
                  </span>
                  <span className="muted small">
                    {measured ? (
                      <>
                        {trait.score}
                        {trait.consistency !== null &&
                          trait.consistency < 0.5 &&
                          ' · varied by situation'}
                      </>
                    ) : answered ? (
                      'Too few answers to report'
                    ) : (
                      'Not answered'
                    )}
                  </span>
                </div>
                {/* The bar is what makes a figure read as a measurement, so it
                    goes wherever the figure does. */}
                {measured && <ScoreBar score={trait.score} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * One behavioural composite: the capability, its score, and the traits it was
 * built from.
 *
 * The contributions are always on show rather than hidden behind a toggle —
 * a composite is a claim about someone's fit for a kind of work, and a
 * recruiter should be able to see it is just five trait scores and five
 * authored weights, then disagree with the blend if they read it differently.
 */
function ProfileCard({ profile }: { profile: ProfileScore }) {
  /*
   * A composite with too little behind it carries no number and no band — the
   * server withholds both rather than sending a figure with a caveat attached.
   *
   * The card stays, because "we asked about this and got too little back" is
   * itself worth knowing, and a silently missing capability would read as one
   * the assessment never covered. What goes is anything that could be mistaken
   * for a finding: the figure, the band, and the filled bar.
   */
  const measured = profile.score !== null && profile.band !== null;

  return (
    <div className="report-module">
      <div className="spread">
        <div>
          <strong>{profile.label}</strong>
          <div className="muted small">{profile.description}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {measured ? (
            <>
              <strong className="report-score">{profile.score}</strong>
              <div>
                <span className={`badge ${BAND_BADGE[profile.band!]}`}>
                  {BAND_LABEL[profile.band!]}
                </span>
              </div>
            </>
          ) : (
            <span className="badge">Not enough answers</span>
          )}
        </div>
      </div>

      {measured && <ScoreBar score={profile.score!} />}

      <div className="muted small">
        {measured ? (
          ''
        ) : (
          <>
            Too few answers touched the traits behind this to report a
            score.{' '}
          </>
        )}
        {profile.contributions.length > 0 ? (
          <>
            Built from{' '}
            {profile.contributions
              .map(
                (c) => `${c.label} ${c.score} (${Math.round(c.weight * 100)}%)`,
              )
              .join(' · ')}
          </>
        ) : (
          'None of its traits were measured.'
        )}
      </div>
    </div>
  );
}

/**
 * Marks a row as one half of a repeat probe and points at the other half.
 *
 * Both halves carry the tag so a recruiter scanning the list can find the pair
 * from either end — the first question gives no hint that it will be revisited.
 */
function ProbeTag({ probe }: { probe: ProbeAnswerLink }) {
  if (probe.partnerSequence === null) {
    return <span className="badge">repeat never asked</span>;
  }

  const consistent = (probe.agreement ?? 0) >= PROBE_HELD_AT;
  const direction = probe.role === 'first' ? 'asked again as' : 'repeat of';

  return (
    <span
      className={`badge ${probe.agreement === null ? '' : consistent ? 'active' : 'archived'}`}
      title={
        probe.gap === null
          ? undefined
          : `${probe.gap} questions apart, reworded with reordered options`
      }
    >
      {direction} Q{probe.partnerSequence}
      {probe.agreement !== null && (consistent ? ' · same' : ' · differed')}
    </span>
  );
}

/** The weights one answer contributed, strongest first. */
function Evidence({ answer }: { answer: AnswerDetail }) {
  if (answer.traitContributions.length === 0) return null;

  return (
    <div className="report-evidence">
      {answer.traitContributions.map((c) => (
        <span
          key={c.key}
          className={`report-weight${c.weight < 0 ? ' negative' : ''}`}
        >
          {c.label} {c.weight > 0 ? '+' : ''}
          {c.weight}
        </span>
      ))}
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
  /** The PDF is built server-side, so the button has to say it is working. */
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!sessionId) return;

    reportsApi
      .summary(sessionId)
      .then(setSummary)
      .catch((err) =>
        setError(describeError(err, 'Could not load the report.')),
      )
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
          {/*
           * When they sat it and how long it took.
           *
           * Two clocks, kept apart. "Elapsed" is start to submit and includes
           * thinking and stepping away; "answering" sums the per-question
           * timers. Presenting only one would either make a candidate who took
           * a phone call look slow, or hide someone who spent an hour on a
           * twenty-minute test.
           */}
          <p className="report-timing">
            <span>
              Started <strong>{formatMoment(summary.timing.startedAt)}</strong>
            </span>
            {summary.timing.submittedAt && (
              <span>
                Submitted{' '}
                <strong>{formatMoment(summary.timing.submittedAt)}</strong>
              </span>
            )}
            {summary.timing.elapsedSeconds !== null && (
              <span>
                <strong>{formatSeconds(summary.timing.elapsedSeconds)}</strong>{' '}
                elapsed
                {/* Said plainly: for a timed-out attempt the elapsed figure is
                    the assessment's own limit, not a choice the candidate
                    made, and reading it as slowness would be unfair. */}
                {summary.timing.autoSubmitted && ' — ran out of time'}
              </span>
            )}
            {summary.timing.timeOnQuestionsSeconds !== null && (
              <span>
                <strong>
                  {formatSeconds(summary.timing.timeOnQuestionsSeconds)}
                </strong>{' '}
                answering
              </span>
            )}
          </p>
        </div>
        <div className="row report-head-actions">
          {/*
           * A server-built PDF, not `window.print()`.
           *
           * Printing was the original approach and could never drift from the
           * screen, because it *was* the screen. What it could never do is
           * download: no web page may skip the browser's print dialog, so a
           * button labelled "Save as PDF" always opened a dialog with a
           * destination to choose — which is how it kept getting reported as
           * broken. The server now renders the file and this saves it, so the
           * label finally describes what happens.
           */}
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              reportsApi
                .downloadPdf(summary.sessionId)
                .catch((err) =>
                  setError(describeError(err, 'Could not build the PDF.')),
                )
                .finally(() => setSaving(false));
            }}
          >
            {saving ? 'Preparing…' : 'Save as PDF'}
          </button>
          <Link to={`/admin/assessments/${summary.assessment.id}/results`}>
            Back to results
          </Link>
        </div>
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
            {/* No score, no band. "Borderline" used to sit here on an attempt
                where nothing was answered, which reads as a verdict somebody
                reached rather than the absence of one. */}
            {report.hiringRecommendation ? (
              <span
                className={`badge ${RECOMMENDATION_BADGE[report.hiringRecommendation]}`}
              >
                {RECOMMENDATION_LABEL[report.hiringRecommendation]}
              </span>
            ) : (
              <span className="badge" title="Nothing scoreable was answered">
                No result
              </span>
            )}
          </div>

          {/* Where the headline came from. Shown only when both halves exist —
              with one section type the blend is just that section's score, and
              spelling out a 70/30 split would imply a weighting that did not
              happen. */}
          {report.abilityScore !== null && report.behavioralScore !== null && (
            <div className="report-blend muted small">
              Ability {report.abilityScore} (70%) · Behavioural profile{' '}
              {report.behavioralScore} (30%)
            </div>
          )}
          {report.abilityScore === null && report.behavioralScore !== null && (
            <div className="report-blend muted small">
              Behavioural profile only — this assessment has no scored section,
              so the profile carries the whole score.
            </div>
          )}

          <p className="report-summary">{report.summary}</p>

          <p className="muted small" style={{ margin: 0 }}>
            Rule-based from the scores below. Proctoring signals never affect it
            — the decision is yours.
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

        {summary.profiles.length > 0 && (
          <div className="card card-pad stack">
            <div>
              <h2>Behavioural profile</h2>
              <p className="muted small" style={{ margin: 0 }}>
                What the trait scores add up to for five kinds of work. These
                describe fit, not quality — a candidate who leans to
                Collaboration over Leadership Readiness is not a worse
                candidate, just a different one.
              </p>
            </div>
            {summary.profiles.map((profile) => (
              <ProfileCard key={profile.key} profile={profile} />
            ))}
          </div>
        )}

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
                          <td>
                            {answer.questionText}
                            {(answer.pattern || answer.probe) && (
                              <div style={{ marginTop: 4 }}>
                                {answer.pattern && (
                                  <span className="badge">
                                    {PATTERN_LABEL[answer.pattern]}
                                  </span>
                                )}
                                {answer.probe && (
                                  <ProbeTag probe={answer.probe} />
                                )}
                              </div>
                            )}
                            {/* §8: show the working, so a recruiter can weigh
                                the answer themselves rather than trust a score. */}
                            <Evidence answer={answer} />
                          </td>
                          <td className="small">
                            {answer.ranking ? (
                              <ol className="report-ranking">
                                {answer.ranking.map((choice) => (
                                  <li key={choice.key}>
                                    {choice.behavior ?? choice.text}
                                  </li>
                                ))}
                              </ol>
                            ) : answer.selectedOption ? (
                              <>
                                <strong>{answer.selectedOption}</strong>
                                {answer.selectedOptionText &&
                                  ` — ${answer.selectedOptionText}`}
                                {answer.behavior && (
                                  <div style={{ marginTop: 4 }}>
                                    <span className="badge">
                                      {answer.behavior}
                                    </span>
                                  </div>
                                )}
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
