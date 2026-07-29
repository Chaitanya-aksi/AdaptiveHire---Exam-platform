/**
 * Every tunable the adaptive engine uses, in one place. These are deliberate
 * v1 defaults — simple Elo-style statistics, no IRT calibration and no ML.
 * Changing a number here changes engine behaviour globally; the values are
 * chosen so an 8-15 question module converges for a typical candidate.
 */

/** Where every candidate starts, matching `DEFAULT_DIFFICULTY_SCORE`. */
export const STARTING_ABILITY = 1000;

/**
 * Elo's logistic constant: a 400-point gap means a 10:1 expected win ratio.
 * Also the divisor that converts Elo points into logits.
 */
export const ELO_D = 400;

/**
 * The candidate's estimate moves fast for the first few answers (when we know
 * almost nothing) and then settles, so one late fluke can't undo a module.
 */
export const K_EARLY = 48;
export const K_LATE = 24;
export const K_SWITCH_AFTER = 5;

/**
 * Questions drift too — a "medium" item that everyone gets wrong is really a
 * hard one. Much smaller K than the candidate's: an item's difficulty should
 * only move meaningfully after many candidates have seen it.
 */
export const K_QUESTION = 8;

/**
 * Assumed spread of the ability prior, in Elo points. Confidence is expressed
 * as how far the standard error has shrunk from this starting spread.
 */
export const ABILITY_PRIOR_SPREAD = 400;

/**
 * Objective modules may stop once the estimate is this settled.
 *
 * Calibrated against real module sizes: 0.7 corresponds to a standard error of
 * ~120 Elo points, which a well-matched candidate reaches after 8-9 questions.
 * Raise it and every candidate simply runs to `maxQuestions`, which throws
 * away the adaptive length entirely.
 */
export const ABILITY_CONFIDENCE_THRESHOLD = 0.7;

/**
 * How many recent ability estimates the stability check looks at.
 *
 * Precision alone (the standard error above) depends only on which questions
 * were served, not on how they were answered — so on its own it stops every
 * well-matched candidate at the same question. Stability is the other half:
 * it asks whether the estimate has actually stopped moving. A candidate
 * answering consistently at their level settles quickly; an erratic one keeps
 * swinging and earns more questions. That is what makes test length differ
 * between candidates.
 */
export const STABILITY_WINDOW = 4;

/**
 * Elo spread across that window at which stability confidence hits zero.
 *
 * With the threshold above, 80 means the window has to stay inside ~24 Elo —
 * roughly one `K_LATE` step. A candidate whose recent answers reverse
 * direction fits inside that (the estimate has found them); one on a run of
 * same-direction moves does not, and earns more questions.
 */
export const STABILITY_BAND = 80;

/**
 * How many near-difficulty candidates the selector shortlists before picking
 * one at random. Purely to break predictable sequences — two candidates of the
 * same ability should not see the same paper.
 */
export const SELECTOR_SHORTLIST_SIZE = 5;

/**
 * Answers per trait before that trait is considered fully covered. Trait
 * confidence is `answered / this`, capped at 1.
 */
export const TRAIT_TARGET_QUESTIONS = 3;

/** Trait modules may stop once every trait reaches this confidence. */
export const TRAIT_CONFIDENCE_THRESHOLD = 1;

/**
 * Per-option trait weights run -2..+2 (strongly disagree .. strongly agree).
 * Reported trait scores are rescaled from that range onto 0..100.
 */
export const TRAIT_WEIGHT_MIN = -2;
export const TRAIT_WEIGHT_MAX = 2;
