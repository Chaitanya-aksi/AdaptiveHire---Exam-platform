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
 * Its job is orientation rather than navigation: a recruiter opening the product
 * for the first time can see the whole shape of it in one glance — where an
 * assessment comes from, what the candidate does, and what they get back at the
 * end. The two buttons underneath are the only things that actually go anywhere.
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
    detail: 'By email, one or a spreadsheet',
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
  { Icon: IconHired, label: 'Hire', detail: 'Your call, with the evidence' },
];

export function JourneyStrip() {
  return (
    <section className="journey">
      <div className="journey-head">
        <h2>How a hire runs on AdaptiveHire</h2>
        <p>From an empty question bank to a decision you can defend.</p>
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
        <Link to="/admin/assessments" className="button primary">
          Create an assessment
        </Link>
        <Link to="/admin/modules" className="button">
          Browse the subjects
        </Link>
      </div>
    </section>
  );
}
