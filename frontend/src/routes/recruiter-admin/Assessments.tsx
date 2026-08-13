import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { QuestionPoolPicker } from '../../components/questions/QuestionPoolPicker';
import { useToast } from '../../components/Toast';
import {
  assessmentsApi,
  modulesApi,
  questionsApi,
  type AssessmentModulePayload,
} from '../../lib/endpoints';
import { describeError } from '../../lib/errors';
import type {
  Assessment,
  ModuleCatalogEntry,
  Question,
} from '../../lib/types';

/** Enough to cover the largest module in the bank in one request. */
const QUESTION_PAGE_SIZE = 200;

interface ModuleRow {
  included: boolean;
  minQuestions: number;
  maxQuestions: number;
  timeLimitSeconds: number;
}

const DEFAULT_ROW: ModuleRow = {
  included: false,
  minQuestions: 5,
  maxQuestions: 12,
  timeLimitSeconds: 600,
};

export function Assessments() {
  const toast = useToast();

  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [modules, setModules] = useState<ModuleCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [rows, setRows] = useState<Record<string, ModuleRow>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The question pool being built, per module, and the questions to pick from.
   *
   * Both keyed by module id and fetched only for modules actually ticked — the
   * bank runs to a few hundred questions, and loading all of them to render a
   * form most people submit unchanged would be wasted.
   *
   * An empty set for a module means no restriction on it, which is the default.
   */
  const [pool, setPool] = useState<Record<string, Set<string>>>({});
  const [available, setAvailable] = useState<Record<string, Question[]>>({});
  const [fetching, setFetching] = useState<Record<string, boolean>>({});

  const load = async () => {
    const [list, mods] = await Promise.all([
      assessmentsApi.list(),
      modulesApi.list(),
    ]);
    setAssessments(list);
    setModules(mods);
  };

  useEffect(() => {
    load()
      .catch((err) => setError(describeError(err, 'Could not load assessments.')))
      .finally(() => setLoading(false));
  }, []);

  const rowFor = (id: string): ModuleRow => rows[id] ?? DEFAULT_ROW;

  /**
   * Loads a module's active questions the first time it is ticked.
   *
   * Only active ones: a draft can never be served, so offering it would let
   * someone build a pool that looks big enough and still starves the module.
   */
  const loadQuestions = useCallback(async (moduleId: string) => {
    setFetching((current) => ({ ...current, [moduleId]: true }));
    try {
      const page = await questionsApi.list({
        moduleId,
        status: 'active',
        limit: QUESTION_PAGE_SIZE,
      });
      setAvailable((current) => ({ ...current, [moduleId]: page.items }));
    } catch (err) {
      setError(describeError(err, 'Could not load questions for that subject.'));
    } finally {
      setFetching((current) => ({ ...current, [moduleId]: false }));
    }
  }, []);

  const patchRow = (id: string, patch: Partial<ModuleRow>) => {
    setRows((current) => ({
      ...current,
      [id]: { ...rowFor(id), ...patch },
    }));

    if (patch.included && !available[id] && !fetching[id]) {
      void loadQuestions(id);
    }
  };

  const poolFor = (moduleId: string): Set<string> =>
    pool[moduleId] ?? new Set<string>();

  const patchPool = (moduleId: string, next: Set<string>) =>
    setPool((current) => ({ ...current, [moduleId]: next }));

  const togglePooled = (moduleId: string, questionId: string) => {
    const next = new Set(poolFor(moduleId));
    if (next.has(questionId)) next.delete(questionId);
    else next.add(questionId);
    patchPool(moduleId, next);
  };

  const setManyPooled = (
    moduleId: string,
    questionIds: string[],
    include: boolean,
  ) => {
    const next = new Set(poolFor(moduleId));
    for (const questionId of questionIds) {
      if (include) next.add(questionId);
      else next.delete(questionId);
    }
    patchPool(moduleId, next);
  };

  const selected = modules.filter((m) => rowFor(m.id).included);
  const canSubmit = title.trim().length >= 2 && selected.length > 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError(null);

    const payloadModules: AssessmentModulePayload[] = selected.map((m, i) => {
      const row = rowFor(m.id);
      return {
        moduleId: m.id,
        minQuestions: row.minQuestions,
        maxQuestions: row.maxQuestions,
        timeLimitSeconds: row.timeLimitSeconds,
        displayOrder: i,
      };
    });

    // Cheap client-side guard; the server enforces this too.
    const badRange = payloadModules.find((m) => m.maxQuestions < m.minQuestions);
    if (badRange) {
      setError('Each module needs max questions ≥ min questions.');
      setBusy(false);
      return;
    }

    // A module with *some* questions chosen but fewer than its own minimum would
    // end every attempt early with an exhausted pool. Choosing none is fine —
    // that means no restriction.
    const starved = selected.find((m) => {
      const chosen = poolFor(m.id).size;
      return chosen > 0 && chosen < rowFor(m.id).minQuestions;
    });
    if (starved) {
      setError(
        `${starved.name}: choose at least ${rowFor(starved.id).minQuestions} ` +
          'questions, or none at all to use every question you can see.',
      );
      setBusy(false);
      return;
    }

    const questionIds = selected.flatMap((m) => [...poolFor(m.id)]);

    try {
      const created = await assessmentsApi.create({
        title: title.trim(),
        description: description.trim() || undefined,
        modules: payloadModules,
        // Omitted when nothing was picked, which leaves the assessment drawing
        // on every question the organisation can see.
        ...(questionIds.length > 0 && { questionIds }),
      });
      toast.success(
        questionIds.length > 0
          ? `Created "${created.title}" with ${questionIds.length} questions.`
          : `Created "${created.title}".`,
      );
      setTitle('');
      setDescription('');
      setRows({});
      setPool({});
      await load();
    } catch (err) {
      setError(describeError(err, 'Could not create the assessment.'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="empty">Loading…</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Assessments</h1>
          <p>Create an assessment, then invite candidates to it.</p>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="stack">
        <div className="card">
          <div className="card-head">
            <h2>New assessment</h2>
          </div>
          <form className="card-pad" onSubmit={(e) => void submit(e)}>
            <div className="field">
              <label htmlFor="title">Title</label>
              <input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Graduate Aptitude Screen"
                maxLength={200}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="description">Description (optional)</label>
              <input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this assessment covers"
                maxLength={2000}
              />
            </div>

            <div className="field">
              <label>Modules</label>
              <p className="field-note">
                Tick the modules to include and set how many questions the
                adaptive engine may ask and the time limit (seconds).
              </p>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 40 }} />
                    <th>Module</th>
                    <th style={{ width: 110 }}>Min</th>
                    <th style={{ width: 110 }}>Max</th>
                    <th style={{ width: 140 }}>Time (s)</th>
                  </tr>
                </thead>
                <tbody>
                  {modules.map((m) => {
                    const row = rowFor(m.id);
                    return (
                      <tr key={m.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={row.included}
                            onChange={(e) =>
                              patchRow(m.id, { included: e.target.checked })
                            }
                          />
                        </td>
                        <td>
                          {m.name}
                          <span className="muted small"> · {m.scoringType}</span>
                        </td>
                        <td>
                          <input
                            type="number"
                            min={1}
                            value={row.minQuestions}
                            disabled={!row.included}
                            onChange={(e) =>
                              patchRow(m.id, {
                                minQuestions: Number(e.target.value),
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min={1}
                            value={row.maxQuestions}
                            disabled={!row.included}
                            onChange={(e) =>
                              patchRow(m.id, {
                                maxQuestions: Number(e.target.value),
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min={1}
                            value={row.timeLimitSeconds}
                            disabled={!row.included}
                            onChange={(e) =>
                              patchRow(m.id, {
                                timeLimitSeconds: Number(e.target.value),
                              })
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {selected.length > 0 && (
              <div className="field" style={{ marginTop: 18 }}>
                <label>Questions</label>
                <p className="field-note">
                  Optional. Leave a subject untouched and the engine draws on
                  every question you can see; choose some and it draws only on
                  those. Either way it still picks question by question on how
                  the candidate is doing.
                </p>
              </div>
            )}

            <div className="stack">
              {selected.map((m) => (
                <QuestionPoolPicker
                  key={m.id}
                  collapsible
                  name={m.name}
                  questions={available[m.id] ?? []}
                  loading={fetching[m.id] ?? false}
                  selected={poolFor(m.id)}
                  minQuestions={rowFor(m.id).minQuestions}
                  maxQuestions={rowFor(m.id).maxQuestions}
                  onToggle={(questionId) => togglePooled(m.id, questionId)}
                  onSetMany={(questionIds, include) =>
                    setManyPooled(m.id, questionIds, include)
                  }
                />
              ))}
            </div>

            <button
              className="primary block"
              type="submit"
              disabled={!canSubmit || busy}
              style={{ marginTop: 16 }}
            >
              {busy ? 'Creating…' : 'Create assessment'}
            </button>
          </form>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Existing assessments</h2>
            <span className="badge">{assessments.length}</span>
          </div>

          {assessments.length === 0 ? (
            <div className="card-pad muted">
              No assessments yet — create one above.
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th style={{ width: 110 }}>Modules</th>
                    <th style={{ width: 260 }} />
                  </tr>
                </thead>
                <tbody>
                  {assessments.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <strong>{a.title}</strong>
                        {a.description && (
                          <div className="muted small">{a.description}</div>
                        )}
                      </td>
                      <td>{a.modules.length}</td>
                      <td>
                        <div className="row">
                          <Link
                            className="button"
                            to={`/admin/assessments/${a.id}/questions`}
                            title={
                              a.questionPool.length === 0
                                ? 'Drawing on every question you can see'
                                : `Restricted to ${a.questionPool.length} questions`
                            }
                          >
                            Questions
                            {a.questionPool.length > 0 &&
                              ` (${a.questionPool.length})`}
                          </Link>
                          <Link
                            className="button"
                            to={`/admin/assessments/${a.id}/invite`}
                          >
                            Invite candidates
                          </Link>
                          <Link
                            className="button"
                            to={`/admin/assessments/${a.id}/results`}
                          >
                            Results
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
