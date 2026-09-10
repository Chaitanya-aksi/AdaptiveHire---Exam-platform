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
 * Labels only, no per-stage sentence. Five icons in a row already say "these
 * happen in this order", and a line of prose under each one was explaining a
 * step whose name had already explained it.
 */
const STAGES = [
  { Icon: IconAssessment, label: 'Build the test' },
  { Icon: IconInvite, label: 'Invite candidates' },
  { Icon: IconAdaptive, label: 'Candidates take the assessment' },
  { Icon: IconReport, label: 'Read the report' },
  { Icon: IconHired, label: 'Hire' },
];

export function JourneyStrip() {
  return (
    <section className="journey">
      <div className="journey-head">
        <h2>How a hire runs on AdaptiveHire</h2>
      </div>

      <ol className="journey-steps">
        {STAGES.map(({ Icon, label }, index) => (
          <li key={label}>
            {/* The connector is drawn by the item, not between items, so the
                first one can simply omit it — no stray line off the left edge. */}
            {index > 0 && <span className="journey-line" aria-hidden="true" />}
            <span className="journey-dot">
              <Icon />
            </span>
            <strong>{label}</strong>
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
