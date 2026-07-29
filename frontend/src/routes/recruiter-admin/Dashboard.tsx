import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { describeError } from '../../lib/errors';
import { questionsApi } from '../../lib/endpoints';
import type { ModuleQuestionStats } from '../../lib/types';

/** Deep link into the question bank's URL-driven filters. */
const bankLink = (params: Record<string, string>): string => {
  const query = new URLSearchParams(params).toString();
  return query ? `/admin/questions?${query}` : '/admin/questions';
};

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

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Question bank health across every subject.</p>
        </div>
        <Link to="/admin/import">
          <button className="primary">Import questions</button>
        </Link>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="stack">
        {/* Each figure answers "show me those" — so each one is a link. */}
        <div className="grid">
          <Link to="/admin/modules" className="card card-pad stat stat-link">
            <div className="label">Subjects</div>
            <div className="value">{loaded ? stats.length : '—'}</div>
            <div className="sub">modules in the catalogue</div>
          </Link>
          <Link to={bankLink({})} className="card card-pad stat stat-link">
            <div className="label">Questions</div>
            <div className="value">{loaded ? totals.questions : '—'}</div>
            <div className="sub">across all subjects</div>
          </Link>
          <Link
            to={bankLink({ status: 'active' })}
            className="card card-pad stat stat-link"
          >
            <div className="label">Active</div>
            <div className="value">{loaded ? totals.active : '—'}</div>
            <div className="sub">servable to candidates</div>
          </Link>
          <Link
            to={bankLink({ status: 'draft' })}
            className="card card-pad stat stat-link"
          >
            <div className="label">Awaiting review</div>
            <div className="value">{loaded ? totals.draft : '—'}</div>
            <div className="sub">imported as draft</div>
          </Link>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>By subject</h2>
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
    </>
  );
}
