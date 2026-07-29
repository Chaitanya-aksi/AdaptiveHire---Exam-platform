import { useEffect, useState } from 'react';
import { modulesApi } from '../../lib/endpoints';
import type { ModuleCatalogEntry } from '../../lib/types';

export function Modules() {
  const [modules, setModules] = useState<ModuleCatalogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    modulesApi
      .list(true)
      .then(setModules)
      .catch(() => setError('Could not load modules.'));
  }, []);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Modules</h1>
          <p>
            Subjects are reference data — new ones are rows, not code, as long as
            they fit one of the two scoring types.
          </p>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="stack">
        {modules === null && <div className="card empty">Loading…</div>}

        {modules?.map((module) => (
          <div className="card" key={module.id}>
            <div className="card-head">
              <div>
                <h2>{module.name}</h2>
                <span className="muted small mono">{module.slug}</span>
              </div>
              <div className="row">
                <span
                  className={`badge ${module.scoringType === 'trait' ? 'accent' : ''}`}
                >
                  {module.scoringType === 'objective'
                    ? 'objective · Elo-scored'
                    : 'trait · weighted'}
                </span>
                {!module.isActive && <span className="badge archived">inactive</span>}
              </div>
            </div>

            <div className="card-pad">
              {module.description && (
                <p className="muted" style={{ marginTop: 0 }}>
                  {module.description}
                </p>
              )}

              {module.scoringType === 'trait' && module.traits && (
                <>
                  <h3 style={{ marginBottom: 8 }}>Traits measured</h3>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Reported as</th>
                          <th>Engine key</th>
                          <th>Direction</th>
                        </tr>
                      </thead>
                      <tbody>
                        {module.traits.map((trait) => (
                          <tr key={trait.key}>
                            <td>
                              <strong>{trait.label}</strong>
                            </td>
                            <td className="mono muted">{trait.key}</td>
                            <td>
                              {trait.invertForReport ? (
                                // The workplace label is the opposite pole of
                                // the Big Five trait, so the score is flipped.
                                <span className="badge accent">inverted</span>
                              ) : (
                                <span className="muted small">direct</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {module.scoringType === 'objective' && (
                <p className="muted small" style={{ margin: 0 }}>
                  Scored right/wrong. Question difficulty and the candidate's
                  ability estimate both live on the Elo scale.
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
