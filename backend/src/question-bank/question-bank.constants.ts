/**
 * Plain constants, deliberately free of decorators or Nest imports, so unit
 * tests can pull them in without bootstrapping reflect-metadata.
 */

/** Elo-scale bounds. Outside this range a question can never be selected. */
export const MIN_DIFFICULTY = 400;
export const MAX_DIFFICULTY = 1600;

/**
 * Four options minimum for objective questions. This caps the guess rate at
 * 25% — with three options a candidate who knows nothing still scores 33%,
 * which inflates the Elo estimate.
 */
export const MIN_OPTIONS = 4;
export const MAX_OPTIONS = 6;

/**
 * Loosest bound any behavioural question can satisfy, used by the DTO. The
 * real per-pattern rule is stricter and lives in `PATTERN_OPTION_BOUNDS`,
 * because only the service knows which pattern it is validating.
 */
export const PERSONALITY_MIN_OPTIONS = 2;

/**
 * How many options each behavioural pattern takes.
 *
 * Forced-choice and trade-off are exactly two by definition — they pit one
 * alternative against one other. Situational and ranking need at least three
 * to say anything: a two-way ranking carries no more information than a
 * forced choice.
 *
 * Legacy Likert questions (null pattern) keep the old four-option floor, which
 * denies the candidate a neutral midpoint to park on.
 */
export const PATTERN_OPTION_BOUNDS: Record<
  string,
  { min: number; max: number }
> = {
  situational: { min: 3, max: MAX_OPTIONS },
  forced_choice: { min: 2, max: 2 },
  trade_off: { min: 2, max: 2 },
  ranking: { min: 3, max: MAX_OPTIONS },
};

/** Bounds applied to a legacy question with no declared pattern. */
export const LEGACY_OPTION_BOUNDS = { min: MIN_OPTIONS, max: MAX_OPTIONS };

/** Matches the `questions.probeGroup` column width. */
export const PROBE_GROUP_MAX_LENGTH = 80;
