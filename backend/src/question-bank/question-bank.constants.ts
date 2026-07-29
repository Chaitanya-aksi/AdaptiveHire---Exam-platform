/**
 * Plain constants, deliberately free of decorators or Nest imports, so unit
 * tests can pull them in without bootstrapping reflect-metadata.
 */

/** Elo-scale bounds. Outside this range a question can never be selected. */
export const MIN_DIFFICULTY = 400;
export const MAX_DIFFICULTY = 1600;

/**
 * Four options minimum, for every module.
 *
 * For objective questions this caps the guess rate at 25% — with three
 * options a candidate who knows nothing still scores 33%, which inflates the
 * Elo estimate. For trait questions it forces an even-numbered scale, so
 * there is no neutral midpoint for a candidate to park on.
 */
export const MIN_OPTIONS = 4;
export const MAX_OPTIONS = 6;
