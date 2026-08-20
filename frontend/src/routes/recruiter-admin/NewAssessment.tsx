import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { QuestionPoolPicker } from '../../components/questions/QuestionPoolPicker';
import { useToast } from '../../components/Toast';
import {
  assessmentsApi,
  modulesApi,
  questionsApi,
  type AssessmentModulePayload,
} from '../../lib/endpoints';
import { describeError } from '../../lib/errors';
import { fromLocalInput } from '../../lib/schedule';
import type { ModuleCatalogEntry, Question } from '../../lib/types';

/*
 * Building an assessment, on a page of its own.
 *
 * This form used to sit on top of the list of existing assessments, which meant
 * the page a recruiter opened forty times to check results led with a long
 * empty form they wanted once. Splitting them costs one navigation and buys
 * both halves room to be legible: the list is a list, and this is a form with
 * enough space to explain itself.
 *
 * The steps are numbered because the last two only make sense in order — the
 * question pool cannot be chosen until the subjects are, and a recruiter who
 * meets all of it at once reads the pool picker as required when it is the one
 * genuinely optional thing here.
 */

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

/** A numbered step heading, so the form reads as a sequence. */
function Step({
  n,
  title,
  note,
  children,
}: {
  n: number;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card na-step">
      <header className="na-step-head">
        <span className="na-step-n" aria-hidden="true">
          {n}
        </span>
        <div>
          <h2>{title}</h2>
          {note && <p className="muted small">{note}</p>}
        </div>
      </header>
      <div className="card-pad stack">{children}</div>
    </section>
  );
}

export function NewAssessment() {
  const toast = useToast();
  const navigate = useNavigate();

  const [modules, setModules] = useState<ModuleCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // Held as datetime-local strings — local wall clock, no zone — and converted
  // on submit. See `lib/schedule.ts` for why that conversion is not inline.
  const [opensAt, setOpensAt] = useState('');
  const [closesAt, setClosesAt] = useState('');
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

  useEffect(() => {
    modulesApi
      .list()
      .then(setModules)
      .catch((err) => setError(describeError(err, 'Could not load subjects.')))
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
      setError(
        describeError(err, 'Could not load questions for that subject.'),
      );
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

  const totalMinutes = Math.round(
    selected.reduce((total, m) => total + rowFor(m.id).timeLimitSeconds, 0) /
      60,
  );
  const minQ = selected.reduce((t, m) => t + rowFor(m.id).minQuestions, 0);
  const maxQ = selected.reduce((t, m) => t + rowFor(m.id).maxQuestions, 0);

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
    const badRange = payloadModules.find(
      (m) => m.maxQuestions < m.minQuestions,
    );
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

    const opensIso = fromLocalInput(opensAt);
    const closesIso = fromLocalInput(closesAt);

    // Checked here as well as on the server so the recruiter is told before
    // the round is created rather than after it fails.
    if (opensIso && closesIso && opensIso >= closesIso) {
      setError('That window closes before it opens. Check the dates.');
      setBusy(false);
      return;
    }

    try {
      const created = await assessmentsApi.create({
        title: title.trim(),
        description: description.trim() || undefined,
        modules: payloadModules,
        // Omitted when nothing was picked, which leaves the assessment drawing
        // on every question the organisation can see.
        ...(questionIds.length > 0 && { questionIds }),
        // Likewise omitted rather than sent null: absent means "no bound", and
        // the create DTO has no null to accept.
        ...(opensIso && { opensAt: opensIso }),
        ...(closesIso && { closesAt: closesIso }),
      });
      toast.success(
        questionIds.length > 0
          ? `Created "${created.title}" with ${questionIds.length} questions.`
          : `Created "${created.title}".`,
      );
      // Straight to the new assessment rather than back to the list. Creating
      // one is always followed by inviting somebody to it, and that is where
      // the invite link lives.
      navigate(`/admin/assessments/${created.id}`);
    } catch (err) {
      setError(describeError(err, 'Could not create the assessment.'));
      setBusy(false);
    }
  };

  if (loading) return <div className="empty">Loading…</div>;

  return (
    <form className="na-page" onSubmit={(e) => void submit(e)}>
      <div className="page-head">
        <div>
          <Link to="/admin/assessments" className="muted small back-link">
            ← Assessments
          </Link>
          <h1>New assessment</h1>
          <p>Set it up here, then invite candidates from its own page.</p>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="stack">
        <Step n={1} title="Details" note="What this round is called.">
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
            <label>When candidates can sit it (optional)</label>
            <div className="a-window">
              <div>
                <span className="field-sub">Opens</span>
                <input
                  type="datetime-local"
                  value={opensAt}
                  onChange={(e) => setOpensAt(e.target.value)}
                  aria-label="Opens at"
                />
              </div>
              <div>
                <span className="field-sub">Closes</span>
                <input
                  type="datetime-local"
                  value={closesAt}
                  onChange={(e) => setClosesAt(e.target.value)}
                  aria-label="Closes at"
                />
              </div>
            </div>
            <p className="field-note">
              Leave either empty for no bound, and both for a round that is open
              from now on. Times are in your own timezone. One candidate can be
              moved off these dates later without disturbing the round — see
              Reschedule on the invite page.
            </p>
          </div>
        </Step>

        <Step
          n={2}
          title="Subjects"
          note="Tick what to include, and how far the adaptive engine may go in each."
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 40 }} />
                  <th>Subject</th>
                  <th style={{ width: 100 }}>Min</th>
                  <th style={{ width: 100 }}>Max</th>
                  <th style={{ width: 130 }}>Time (s)</th>
                </tr>
              </thead>
              <tbody>
                {modules.map((m) => {
                  const row = rowFor(m.id);
                  return (
                    <tr key={m.id} className={row.included ? 'na-on' : ''}>
                      <td>
                        <input
                          type="checkbox"
                          checked={row.included}
                          aria-label={`Include ${m.name}`}
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
                          aria-label={`${m.name} minimum questions`}
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
                          aria-label={`${m.name} maximum questions`}
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
                          aria-label={`${m.name} time limit in seconds`}
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
        </Step>

        {/* Only once there is something to restrict. An empty picker above a
            list of unticked subjects is a control with nothing to control. */}
        {selected.length > 0 && (
          <Step
            n={3}
            title="Questions (optional)"
            note="Leave a subject untouched and the engine draws on every question you can see; choose some and it draws only on those. Either way it still picks question by question on how the candidate is doing."
          >
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
          </Step>
        )}
      </div>

      {/* Sticks to the bottom of the viewport, with the shape of the test so
          far beside it — the numbers are spread across the table above, and a
          recruiter should not have to add up five time limits in their head to
          notice they have built a two-hour assessment. */}
      <footer className="na-bar">
        <div className="na-summary">
          {selected.length === 0 ? (
            <span className="muted">Pick at least one subject.</span>
          ) : (
            <>
              <strong>{selected.length}</strong> subject
              {selected.length === 1 ? '' : 's'} ·{' '}
              <strong>{minQ === maxQ ? minQ : `${minQ}–${maxQ}`}</strong>{' '}
              questions · <strong>{totalMinutes}</strong> min
            </>
          )}
        </div>
        <div className="row">
          <Link to="/admin/assessments" className="button">
            Cancel
          </Link>
          <button
            className="primary"
            type="submit"
            disabled={!canSubmit || busy}
          >
            {busy ? 'Creating…' : 'Create assessment'}
          </button>
        </div>
      </footer>
    </form>
  );
}
