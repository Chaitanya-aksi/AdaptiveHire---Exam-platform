import { Link } from 'react-router-dom';
import {
  IconAdaptive,
  IconAssessment,
  IconHired,
  IconInvite,
  IconReport,
} from '../Icons';

/**
 * The five stages of a hire, in order, connected by a line.
 *
 * Its job is orientation rather than navigation: the whole shape of the product
 * in one glance. The two buttons underneath are the only things that actually go
 * anywhere.
 *
 * Each stage carries a short fragment rather than a sentence. Enough to say
 * what happens at that point, not enough to read as documentation.
 */
const STAGES = [
  {
    Icon: IconAssessment,
    label: 'Build the test',
    detail: 'Pick subjects and questions',
  },
  {
    Icon: IconInvite,
    label: 'Invite candidates',
    detail: 'By email or spreadsheet',
  },
  {
    Icon: IconAdaptive,
    label: 'Candidates take the assessment',
    detail: 'Difficulty adapts as they answer',
  },
  {
    Icon: IconReport,
    label: 'Read the report',
    detail: 'Ability, behaviour, every answer',
  },
  { Icon: IconHired, label: 'Hire', detail: 'Make the decision' },
];

export function JourneyStrip() {
  return (
    <section className="journey">
      <div className="journey-head">
        <h2>How a hire runs on AdaptiveHire</h2>
        <p>How the process works, end to end.</p>
      </div>

      <ol className="journey-steps">
        {STAGES.map(({ Icon, label, detail }, index) => (
          <li key={label}>
            {/* The connector is drawn by the item, not between items, so the
                first one can simply omit it — no stray line off the left edge. */}
            {index > 0 && <span className="journey-line" aria-hidden="true" />}
            <span className="journey-dot">
              <Icon />
            </span>
            <strong>{label}</strong>
            <span className="muted small">{detail}</span>
          </li>
        ))}
      </ol>

      <div className="journey-actions">
        <Link to="/admin/assessments/new" className="button primary">
          Create an assessment
        </Link>
        <Link to="/admin/modules" className="button">
          Browse the subjects
        </Link>
      </div>
    </section>
  );
}
