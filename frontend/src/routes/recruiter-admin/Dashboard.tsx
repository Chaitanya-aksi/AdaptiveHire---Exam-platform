import { useEffect, useState, type ComponentType } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { JourneyStrip } from '../../components/dashboard/JourneyStrip';
import {
  IconArrow,
  IconAssessment,
  IconBank,
  IconImport,
  IconModules,
  IconPeople,
  IconReport,
  IconShield,
} from '../../components/Icons';
import { useAuth } from '../../lib/auth';
import { questionsApi } from '../../lib/endpoints';
import { describeError } from '../../lib/errors';
import type { ModuleQuestionStats } from '../../lib/types';

/** Deep link into the question bank's URL-driven filters. */
const bankLink = (params: Record<string, string>): string => {
  const query = new URLSearchParams(params).toString();
  return query ? `/admin/questions?${query}` : '/admin/questions';
};

interface Destination {
  to: string;
  Icon: ComponentType;
  title: string;
  body: string;
}

/**
 * The three things a recruiter is nearly always here to do.
 *
 * Deliberately short. A hub that offers everything equally offers nothing — these
 * get the large treatment and the rest sits in `EXPLORE` below, one rung quieter.
 */
const PRIMARY: Destination[] = [
  {
    to: '/admin/assessments',
    Icon: IconAssessment,
    title: 'Host a test',
    body: 'Choose subjects, set how many questions and how long, and pick which questions the engine may draw from.',
  },
  {
    to: '/admin/assessments',
    Icon: IconPeople,
    title: 'Hire candidates',
    body: 'Invite people by email or upload a spreadsheet, then track who has started, finished or not replied.',
  },
  {
    to: '/admin/questions',
    Icon: IconBank,
    title: 'Build your question bank',
    body: 'Use the questions that ship with the platform, or write your own — private to your organisation.',
  },
];

/** Everywhere else, one click away. */
const EXPLORE: Destination[] = [
  {
    to: '/admin/modules',
    Icon: IconModules,
    title: 'Take a look at the modules',
    body: 'Aptitude, logical reasoning, verbal ability and a behavioural profile.',
  },
  {
    to: '/admin/import',
    Icon: IconImport,
    title: 'Bulk import questions',
    body: 'Upload a CSV or Excel sheet. Bad rows are reported, not fatal.',
  },
  {
    to: '/admin/assessments',
    Icon: IconReport,
    title: 'Candidate reports',
    body: 'Ability scores, behavioural profile and every answer, per attempt.',
  },
  {
    to: bankLink({ status: 'draft' }),
    Icon: IconAssessment,
    title: 'Review drafts',
    body: 'Imported questions land as drafts until you activate them.',
  },
  {
    to: '/admin/people',
    Icon: IconPeople,
    title: 'People',
    body: 'Everyone with an account in your organisation.',
  },
  {
    to: '/admin/assessments',
    Icon: IconShield,
    title: 'Proctoring signals',
    body: 'Recorded per attempt and shown as evidence — never an automatic fail.',
  },
];

/** A tile that navigates. Shared shape so the two rows stay visually related. */
function TileLink({
  destination,
  large = false,
}: {
  destination: Destination;
  large?: boolean;
}) {
  const { to, Icon, title, body } = destination;
  return (
    <Link to={to} className={`tile${large ? ' tile-lg' : ''}`}>
      <span className="tile-icon">
        <Icon />
      </span>
      <strong>{title}</strong>
      <span className="tile-body muted">{body}</span>
      <span className="tile-go" aria-hidden="true">
        <IconArrow />
      </span>
    </Link>
  );
}

/**
 * A count that links to the matching filter — unless it's zero, which would
 * link to a guaranteed empty table.
 */
function CountCell({ count, to }: { count: number; to: string }) {
  if (count === 0) return <span className="muted">0</span>;
  return (
    <Link to={to} className="count-link" onClick={(e) => e.stopPropagation()}>
      {count}
    </Link>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [stats, setStats] = useState<ModuleQuestionStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // One request for the whole page. Deriving these counts client-side meant
    // 13 requests per load, which tripped the API rate limiter.
    questionsApi
      .stats()
      .then((rows) => {
        if (!cancelled) setStats(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(describeError(err, 'Could not load dashboard data.'));
          setStats([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const totals = (stats ?? []).reduce(
    (acc, s) => ({
      questions: acc.questions + s.total,
      active: acc.active + s.active,
      draft: acc.draft + s.draft,
    }),
    { questions: 0, active: 0, draft: 0 },
  );

  const loaded = stats !== null;
  const firstName = user?.fullName.trim().split(/\s+/)[0] ?? 'there';

  return (
    <div className="stack-lg">
      {/* Hero. Says what this place is for and gives the one action most
          sessions start with, rather than opening on a table of counts. */}
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">Your workspace</span>
          <h1>Welcome back, {firstName}.</h1>
          <p>
            AdaptiveHire runs the assessment side of hiring — a test whose
            difficulty adjusts question by question, and a report that shows you
            exactly how the score was reached.
          </p>
          <div className="hero-actions">
            <Link to="/admin/assessments" className="button primary">
              Create an assessment
            </Link>
            <Link to="/admin/import" className="button">
              Import questions
            </Link>
          </div>
        </div>

        {/* The figures live in the hero so the page opens with the state of the
            workspace, not just links. Each one is a link to the same filter. */}
        <dl className="hero-figures">
          <Link to={bankLink({})}>
            <dt>Questions ready</dt>
            <dd>{loaded ? totals.questions : '—'}</dd>
          </Link>
          <Link to={bankLink({ status: 'active' })}>
            <dt>Servable now</dt>
            <dd>{loaded ? totals.active : '—'}</dd>
          </Link>
          <Link to="/admin/modules">
            <dt>Subjects</dt>
            <dd>{loaded ? stats.length : '—'}</dd>
          </Link>
          <Link to={bankLink({ status: 'draft' })}>
            <dt>Awaiting review</dt>
            <dd>{loaded ? totals.draft : '—'}</dd>
          </Link>
        </dl>
      </section>

      {error && <div className="alert error">{error}</div>}

      <section>
        <div className="section-head">
          <h2>Start here</h2>
          <p>The three things most sessions begin with.</p>
        </div>
        <div className="tile-grid tile-grid-lg">
          {PRIMARY.map((destination) => (
            <TileLink key={destination.title} destination={destination} large />
          ))}
        </div>
      </section>

      <JourneyStrip />

      <section>
        <div className="section-head">
          <h2>Everything else</h2>
          <p>The rest of the platform, one click away.</p>
        </div>
        <div className="tile-grid">
          {EXPLORE.map((destination) => (
            <TileLink key={destination.title} destination={destination} />
          ))}
        </div>
      </section>

      <div className="card">
        <div className="card-head">
          <h2>Question bank by subject</h2>
          <Link to="/admin/questions" className="small">
            View question bank →
          </Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                <th>Scoring</th>
                <th>Questions</th>
                <th>Active</th>
                <th>Draft</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {!loaded && (
                <tr>
                  <td colSpan={6} className="empty">
                    Loading…
                  </td>
                </tr>
              )}

              {loaded && stats.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">
                    {error ? 'No data to show.' : 'No modules yet.'}
                  </td>
                </tr>
              )}

              {/*
                The whole row is clickable for the mouse, but the real
                keyboard/screen-reader targets are the anchors inside it —
                a <tr> can't be focused, so the row handler is convenience
                only and never the sole way to reach a destination.
              */}
              {loaded &&
                stats.map((row) => (
                  <tr
                    key={row.moduleId}
                    className="row-link"
                    onClick={() =>
                      void navigate(bankLink({ moduleId: row.moduleId }))
                    }
                  >
                    <td>
                      <Link
                        to={bankLink({ moduleId: row.moduleId })}
                        className="subject-link"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {row.name}
                      </Link>
                      <div className="muted small">{row.slug}</div>
                    </td>
                    <td>
                      <span
                        className={`badge ${row.scoringType === 'trait' ? 'accent' : ''}`}
                      >
                        {row.scoringType}
                      </span>
                    </td>
                    <td>{row.total}</td>
                    <td>
                      <CountCell
                        count={row.active}
                        to={bankLink({
                          moduleId: row.moduleId,
                          status: 'active',
                        })}
                      />
                    </td>
                    <td>
                      <CountCell
                        count={row.draft}
                        to={bankLink({
                          moduleId: row.moduleId,
                          status: 'draft',
                        })}
                      />
                    </td>
                    <td className="go" aria-hidden="true">
                      →
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
