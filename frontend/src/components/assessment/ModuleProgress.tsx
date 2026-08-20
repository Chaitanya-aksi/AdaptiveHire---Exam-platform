import type { RuntimeModule } from '../../lib/types';

interface ModuleProgressProps {
  modules: RuntimeModule[];
  currentIndex: number;
  answered: number;
  min: number;
  max: number;
}

/**
 * Sections done / in progress / still to come, plus how far through the
 * current one the candidate is.
 *
 * The bar is deliberately drawn against the *maximum* and never labelled with
 * a total: an adaptive module can end anywhere between the minimum and the
 * maximum, and promising "12 questions" would be a lie for most candidates.
 */
export function ModuleProgress({
  modules,
  currentIndex,
  answered,
  min,
  max,
}: ModuleProgressProps) {
  const percent = max > 0 ? Math.min(100, (answered / max) * 100) : 0;

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

      <QuestionQueue answered={answered} min={min} max={max} />

      <p className="muted small assess-progress-note">
        {answered} answered in this section — it ends somewhere between {min}{' '}
        and {max} questions, depending on your answers.
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
 * Drawn against `max`, like the bar above it, because the module is adaptive
 * and has no fixed length. The slots past `min` are dimmed further: they are
 * the ones that may never be asked, and showing them at full strength would
 * promise a number of questions nobody can promise.
 */
function QuestionQueue({
  answered,
  min,
  max,
}: {
  answered: number;
  min: number;
  max: number;
}) {
  if (max <= 0) return null;

  return (
    <ol className="assess-queue" aria-label="Questions in this section">
      {Array.from({ length: max }, (_, i) => {
        const number = i + 1;
        const done = number <= answered;
        const current = number === answered + 1;
        // Past the guaranteed minimum, so it may never be reached.
        const beyondMin = number > min;

        return (
          <li
            key={number}
            className={`assess-q${done ? ' assess-q--done' : ''}${
              current ? ' assess-q--now' : ''
            }${!done && !current && beyondMin ? ' assess-q--maybe' : ''}`}
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
