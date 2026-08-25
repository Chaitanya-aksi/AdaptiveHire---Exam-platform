import { useMemo, useState } from 'react';
import type { Question } from '../../lib/types';

interface QuestionPoolPickerProps {
  /** Section heading — the module's name. */
  name: string;
  /** Active questions available for this module. */
  questions: Question[];
  /** Ids currently chosen, from this module only. */
  selected: Set<string>;
  /** Exactly how many questions this section asks. */
  questionCount: number;
  onToggle: (questionId: string) => void;
  /** Bulk include/exclude, used by each column's All / None. */
  onSetMany: (questionIds: string[], include: boolean) => void;
  /**
   * Start collapsed behind a summary line. Used inside the create form, where
   * several expanded question lists would bury the submit button.
   */
  collapsible?: boolean;
  /** Shown in place of the lists before the questions have been fetched. */
  loading?: boolean;
}

/**
 * Choosing an assessment's question pool, split by who owns the questions.
 *
 * Two columns rather than one long list, because the two sources are used
 * differently: the platform bank is content you accept or reject wholesale, while
 * your own questions are the ones you wrote for this role and almost always want.
 * Reading them as one undifferentiated scroll of sixty rows made that distinction
 * something you had to squint at a badge to see.
 *
 * Shared by the create form and the edit page so the two cannot drift on the rule
 * that reads backwards until you know it: **choosing nothing means no
 * restriction**, not an empty assessment. The engine then draws on every question
 * the organisation can see.
 */
export function QuestionPoolPicker({
  name,
  questions,
  selected,
  questionCount,
  onToggle,
  onSetMany,
  collapsible = false,
  loading = false,
}: QuestionPoolPickerProps) {
  const [open, setOpen] = useState(!collapsible);

  const { own, platform } = useMemo(
    () => ({
      own: questions.filter((q) => q.organisationId !== null),
      platform: questions.filter((q) => q.organisationId === null),
    }),
    [questions],
  );

  const chosen = questions.filter((q) => selected.has(q.id)).length;
  const curating = chosen > 0;
  // A pool thinner than the section is a section that runs out of questions.
  const tooFew = curating && chosen < questionCount;

  return (
    <div className="card pool-card">
      <div className="card-head">
        <div>
          <h3 style={{ margin: 0 }}>{name}</h3>
          <div className="muted small">
            {curating
              ? `${chosen} of ${questions.length} chosen`
              : `all ${questions.length} questions`}{' '}
            · asks {questionCount}
            {tooFew && (
              <span className="error-note">
                {' '}
                · needs {questionCount} to fill the section
              </span>
            )}
          </div>
        </div>

        {collapsible && (
          <button
            type="button"
            className="link"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Hide' : 'Choose questions'}
          </button>
        )}
      </div>

      {open &&
        (loading ? (
          <div className="card-pad muted small">Loading questions…</div>
        ) : questions.length === 0 ? (
          <div className="card-pad muted small">
            No active questions in this subject yet.
          </div>
        ) : (
          <div className="pool-grid">
            <PoolColumn
              title="Your questions"
              hint="Written by your organisation"
              questions={own}
              selected={selected}
              onToggle={onToggle}
              onSetMany={onSetMany}
              emptyMessage="You haven't written any questions for this subject yet. Add them in the question bank and they'll appear here."
            />
            <PoolColumn
              title="Platform questions"
              hint="Shared starter bank · read-only"
              questions={platform}
              selected={selected}
              onToggle={onToggle}
              onSetMany={onSetMany}
              emptyMessage="The platform bank has no questions for this subject."
            />
          </div>
        ))}
    </div>
  );
}

interface PoolColumnProps {
  title: string;
  hint: string;
  questions: Question[];
  selected: Set<string>;
  onToggle: (questionId: string) => void;
  onSetMany: (questionIds: string[], include: boolean) => void;
  emptyMessage: string;
}

/** One side of the split — its own count, its own bulk actions, its own scroll. */
function PoolColumn({
  title,
  hint,
  questions,
  selected,
  onToggle,
  onSetMany,
  emptyMessage,
}: PoolColumnProps) {
  const ids = questions.map((q) => q.id);
  const chosen = questions.filter((q) => selected.has(q.id)).length;
  const allChosen = questions.length > 0 && chosen === questions.length;

  return (
    <section className="pool-col">
      <header>
        <div className="pool-col-title">
          <strong>{title}</strong>
          <span className="muted small">
            {questions.length === 0
              ? hint
              : `${chosen} of ${questions.length} selected · ${hint}`}
          </span>
        </div>

        {questions.length > 0 && (
          <div className="row-actions">
            <button
              type="button"
              className="link"
              disabled={allChosen}
              onClick={() => onSetMany(ids, true)}
            >
              All
            </button>
            <button
              type="button"
              className="link"
              disabled={chosen === 0}
              onClick={() => onSetMany(ids, false)}
            >
              None
            </button>
          </div>
        )}
      </header>

      {questions.length === 0 ? (
        <p className="pool-empty muted small">{emptyMessage}</p>
      ) : (
        <ul className="pool-list">
          {questions.map((question) => (
            <li
              key={question.id}
              className={selected.has(question.id) ? 'on' : ''}
            >
              <label>
                <input
                  type="checkbox"
                  checked={selected.has(question.id)}
                  onChange={() => onToggle(question.id)}
                />
                <span className="pool-text">
                  {question.questionText}
                  <span className="pool-meta muted small">
                    {metaFor(question)}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The one fact worth showing per row.
 *
 * Difficulty for an objective question, because the engine adapts on it and a
 * pool squeezed into a narrow band leaves it nothing to adapt between. The
 * behavioural pattern for a trait question, for the same reason applied to
 * question shape.
 */
function metaFor(question: Question): string {
  if (question.mcqDetails) {
    return `difficulty ${question.mcqDetails.difficultyScore}`;
  }
  const pattern = question.personalityDetails?.pattern;
  return pattern ? pattern.replace('_', ' ') : 'agree / disagree';
}
