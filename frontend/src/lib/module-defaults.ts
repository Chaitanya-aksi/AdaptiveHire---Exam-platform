import type { ScoringType } from './types';

/**
 * What a section is worth by default, per kind of subject.
 *
 * Personality sections are policy rather than a starting point: a behavioural
 * profile is built from ten traits, and a short section spreads too few answers
 * across too many of them to say anything with confidence. Forty questions over
 * thirty minutes is what the profile needs to be worth putting in front of a
 * recruiter, so that is what the form fills in the moment a trait subject is
 * ticked (2026-08-24).
 *
 * Objective subjects — aptitude, logical reasoning, verbal ability — stay
 * hand-configured. Their length is a judgement about the role being hired for
 * rather than something the scoring model demands.
 *
 * The second copy of this lives at `backend/src/assessments/module-defaults.ts`.
 * They are duplicated because the two builds share no package; a change to one
 * has to be made in the other in the same commit.
 */
export const MODULE_DEFAULTS: Record<
  ScoringType,
  { questionCount: number; timeLimitSeconds: number } | null
> = {
  trait: { questionCount: 40, timeLimitSeconds: 1800 },
  objective: null,
};

/** What a freshly ticked subject should be filled in with. */
export function defaultsFor(scoringType: ScoringType): {
  questionCount: number;
  timeLimitSeconds: number;
} {
  return (
    MODULE_DEFAULTS[scoringType] ?? { questionCount: 12, timeLimitSeconds: 600 }
  );
}
