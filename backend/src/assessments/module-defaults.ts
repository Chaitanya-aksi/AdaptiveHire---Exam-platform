import { ScoringType } from '../common/enums';

/**
 * What a section is worth by default, per kind of subject.
 *
 * Personality sections are fixed policy rather than a starting point somebody
 * tunes: a behavioural profile is built from ten traits, and a short section
 * spreads too few answers across too many of them to say anything with
 * confidence. Forty questions over thirty minutes is what the profile needs to
 * be worth putting in front of a recruiter, so that is what an assessment gets
 * the moment it includes one (2026-08-24).
 *
 * Objective subjects — aptitude, logical reasoning, verbal ability — stay
 * hand-configured. Their length is a judgement about the role being hired for,
 * not about what the scoring model needs, and nobody has asked for it to be
 * decided for them.
 *
 * Shared with the frontend by duplication rather than import: the two build
 * separately and there is no shared package. `frontend/src/lib/module-defaults.ts`
 * is the other copy, and the two carry a note pointing at each other.
 */
export const MODULE_DEFAULTS: Record<
  ScoringType,
  { questionCount: number; timeLimitSeconds: number } | null
> = {
  /** Trait subjects get the behavioural default. */
  [ScoringType.TRAIT]: { questionCount: 40, timeLimitSeconds: 1800 },
  /** Objective subjects are configured by the recruiter, so no default here. */
  [ScoringType.OBJECTIVE]: null,
};

/**
 * The default for a subject, or null when it has none.
 *
 * Returns the shape a caller should *start* from, not a value it must use — the
 * recruiter can still change the numbers on the form, and the API accepts what
 * it is sent. Making it a hard override would mean an assessment silently
 * ignoring what somebody typed, which is worse than a default they can see.
 */
export function defaultsFor(
  scoringType: ScoringType,
): { questionCount: number; timeLimitSeconds: number } | null {
  return MODULE_DEFAULTS[scoringType];
}
