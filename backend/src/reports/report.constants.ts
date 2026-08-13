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

/**
 * Behavioural consistency bands, and the line above which a repeat probe counts
 * as having held. Used only to word the report.
 *
 * Neither consistency nor a probe result moves the hiring recommendation. They
 * are not lie detectors: answering differently in different situations is
 * ordinary human behaviour, and the report's job is to point the recruiter at
 * the per-answer evidence rather than to score anyone down for it.
 *
 * Trait *scores* do reach the recommendation, but only through the composites
 * below and only at `BEHAVIORAL_WEIGHT` — a statement about fit for a kind of
 * work, never a rating of the personality itself, and no single trait can move
 * the outcome. How reliably a trait was expressed stays out of it entirely.
 */
export const CONSISTENT_AT = 0.7;
export const VARIED_AT = 0.4;

// ── Behavioural composites ─────────────────────────────────────────────────

/**
 * Bands for a behavioural composite, used for wording only.
 *
 * Deliberately narrower than STRONG_SCORE/WEAK_SCORE: a composite is a weighted
 * mean of several traits, so it sits closer to the middle than any single trait
 * does, and reusing the trait thresholds would report every candidate as
 * unremarkable. "Developing" rather than "weak" because these describe fit for
 * a kind of work, not a deficiency.
 */
export const BEHAVIORAL_STRONG_AT = 65;
export const BEHAVIORAL_MODERATE_AT = 45;

/**
 * How the two halves of a candidate's result combine into the overall score
 * that drives the recommendation.
 *
 * Ability leads because it is the harder measure: an objective answer is right
 * or wrong, while a behavioural one is a self-report of what someone would do.
 * The behavioural share is real but minority — enough that a strong profile
 * lifts a middling score and a poor one tempers a good score, not enough for
 * either to decide the outcome on its own.
 *
 * When only one half exists it takes the full weight, so a personality-only
 * assessment produces a real score and a real recommendation instead of sitting
 * at "borderline" forever, and an objective-only assessment is unaffected.
 */
export const ABILITY_WEIGHT = 0.7;
export const BEHAVIORAL_WEIGHT = 0.3;
