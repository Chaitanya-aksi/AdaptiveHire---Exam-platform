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

      <p className="muted small assess-progress-note">
        {answered} answered in this section — it ends somewhere between {min}{' '}
        and {max} questions, depending on your answers.
      </p>
    </div>
  );
}
