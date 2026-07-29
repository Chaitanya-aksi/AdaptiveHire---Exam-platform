/**
 * Reporting thresholds. All rule-based — no model, no AI, no learned weights.
 * A recruiter should be able to read these numbers and predict exactly what a
 * report will say.
 */

/**
 * Elo range mapped onto the 0-100 reporting scale.
 *
 * Tied to the question bank's actual difficulty spread (600-1300) rather than
 * to the theoretical Elo range: a candidate cannot demonstrate ability the
 * bank has no questions for, so anchoring outside that span would compress
 * every real score into the middle of the scale.
 */
export const ABILITY_FLOOR = 600;
export const ABILITY_CEILING = 1400;

/** A module or trait at or above this reads as a strength. */
export const STRONG_SCORE = 65;
/** At or below this, a weakness. */
export const WEAK_SCORE = 35;

/**
 * A trait measured with less confidence than this is reported but never called
 * a strength or a weakness — two answers is not a personality finding.
 */
export const MIN_TRAIT_CONFIDENCE = 0.5;

/** Overall-score bands for the rule-based recommendation. */
export const STRONGLY_RECOMMENDED_AT = 75;
export const RECOMMENDED_AT = 55;
export const BORDERLINE_AT = 40;

/**
 * Share of each module's configured minimum a candidate must have answered for
 * the result to carry its full weight. Below this the recommendation is capped
 * at `borderline` — not as a penalty, but because there isn't enough evidence
 * to say more. Proctoring violations never affect it.
 */
export const MIN_COVERAGE_RATIO = 0.6;
