import type { RuntimeModule } from '../../lib/types';

interface ModuleProgressProps {
  modules: RuntimeModule[];
  currentIndex: number;
  answered: number;
  /** Exactly how many questions this section asks. */
  questionCount: number;
}

/**
 * Sections done / in progress / still to come, plus how far through the
 * current one the candidate is.
 *
 * The bar and the count can now both be stated outright. They used to be
 * deliberately vague — sections ended anywhere between a minimum and a maximum
 * once the estimate settled, so "12 questions" would have been a lie for most
 * candidates. Sections are a fixed length since 2026-08-24, so the honest thing
 * is to say the number.
 */
export function ModuleProgress({
  modules,
  currentIndex,
  answered,
  questionCount,
}: ModuleProgressProps) {
  const percent =
    questionCount > 0 ? Math.min(100, (answered / questionCount) * 100) : 0;

  return (
    <div className="assess-progress">
      <ol className="assess-steps">
        {modules.map((module, index) => (
          <li
            key={module.moduleId}
            className={
              index === currentIndex
                ? 'current'
                : module.status === 'completed'
                  ? 'done'
                  : ''
            }
          >
            <span className="assess-step-dot" aria-hidden="true" />
            {module.name}
          </li>
        ))}
      </ol>

      <div className="assess-bar" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>

      <QuestionQueue answered={answered} questionCount={questionCount} />

      <p className="muted small assess-progress-note">
        {answered} of {questionCount} answered in this section.
      </p>
    </div>
  );
}

/**
 * The question numbers, as a queue.
 *
 * **Nothing here is a control.** These are `<span>`s inside a list, not
 * buttons, and that is the whole design rather than an oversight: answers are
 * final and previous questions cannot be revisited — enforced in Redis on the
 * server, which would refuse a jump anyway. Rendering a clickable-looking chip
 * that then does nothing is worse than rendering a label, so they are labels.
 *
 * Every slot is now a real one. There used to be a third state — dashed chips
 * past the section's minimum, for questions that might never be asked — which
 * a fixed-length section no longer has.
 */
function QuestionQueue({
  answered,
  questionCount,
}: {
  answered: number;
  questionCount: number;
}) {
  if (questionCount <= 0) return null;

  return (
    <ol className="assess-queue" aria-label="Questions in this section">
      {Array.from({ length: questionCount }, (_, i) => {
        const number = i + 1;
        const done = number <= answered;
        const current = number === answered + 1;

        return (
          <li
            key={number}
            className={`assess-q${done ? ' assess-q--done' : ''}${
              current ? ' assess-q--now' : ''
            }`}
            aria-current={current ? 'step' : undefined}
          >
            <span aria-hidden="true">{number}</span>
            <span className="sr-only">
              {done
                ? `Question ${number}, answered`
                : current
                  ? `Question ${number}, current`
                  : `Question ${number}, not yet asked`}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
