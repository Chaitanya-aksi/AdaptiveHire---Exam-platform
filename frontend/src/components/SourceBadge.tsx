import { SOURCE_LABEL, type InvitationSource } from '../lib/types';

/**
 * How a candidate reached the assessment, stated wherever their result is.
 *
 * **Both cases are shown, never only the self-registered one.** Marking only
 * the self-registered attempts turns a fact about how the round was run into an
 * accusation against a particular candidate; marking both makes it the scale
 * the result sits on. That is the same rule `expectedByChance` follows, and the
 * reason it exists is the same: say what is behind a number rather than letting
 * it be read as more than it is.
 *
 * A recruiter comparing two people deserves to know that one was invited by
 * name — somebody vouched for that address — and the other typed their own into
 * a link. Neither is a verdict.
 */
export function SourceBadge({
  source,
  tone = 'short',
}: {
  source: InvitationSource;
  /**
   * `short` for a table cell, where the full sentence would crowd out the name
   * it sits under; `full` on the report, where there is room to say it plainly.
   */
  tone?: 'short' | 'full';
}) {
  const short = source === 'self' ? 'Self-registered' : 'Invited';

  return (
    <span
      className={`badge ${source === 'self' ? '' : 'accent'}`}
      // The long form on hover in a table, so the short label never has to
      // carry the whole meaning on its own.
      title={SOURCE_LABEL[source]}
    >
      {tone === 'full' ? SOURCE_LABEL[source] : short}
    </span>
  );
}
