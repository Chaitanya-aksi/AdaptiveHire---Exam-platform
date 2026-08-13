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
 * Per-option trait weights run -3..+3, the range the behavioural question
 * tables are authored against (a strongly counter-indicative option sits at
 * -3, a strongly indicative one at +3). Reported trait scores are rescaled
 * from that range onto 0..100.
 *
 * Legacy Likert options were authored at -2..+2 and stay valid — they simply
 * cannot drive a trait to either extreme on their own, which is correct: an
 * agree/disagree statement is weaker evidence than a behavioural choice.
 */
export const TRAIT_WEIGHT_MIN = -3;
export const TRAIT_WEIGHT_MAX = 3;

// ── Behavioural engine ─────────────────────────────────────────────────────

/**
 * Multiplier applied to the option a candidate ranked first, and (negated) to
 * the one they ranked last.
 *
 * Ranking runs "most like you" to "least like you", so the scale is symmetric
 * about zero rather than a decay to zero: putting something last is a genuine
 * statement that it is unlike you, and must subtract from those traits. A pure
 * decay would only ever add weight and would inflate every trait it touched.
 */
export const RANKING_EXTREME_FACTOR = 1;

/**
 * Where one ranked option sits on that scale: +1 at the top, -1 at the bottom,
 * spread evenly in between. Four options give +1, +1/3, -1/3, -1.
 *
 * Derived rather than a fixed table so a question with any number of options
 * scores consistently.
 */
export function rankingPositionFactor(position: number, total: number): number {
  if (total <= 1) return RANKING_EXTREME_FACTOR;
  return RANKING_EXTREME_FACTOR * (1 - (2 * position) / (total - 1));
}

/**
 * Contributions to one trait needed before consistency means anything.
 *
 * A single answer cannot be inconsistent with anything, so it reports as
 * unmeasured rather than as perfect consistency — which would otherwise make
 * a barely-evidenced trait look like the most reliable one in the profile.
 */
export const CONSISTENCY_MIN_SAMPLES = 2;

/**
 * Standard deviation of a trait's contributions at which consistency hits
 * zero. Two answers at opposite extremes of the -3..+3 scale sit exactly this
 * far apart, so that case scores 0 and identical answers score 1.
 */
export const CONSISTENCY_ZERO_AT_STDEV = 3;

/**
 * How often the selector may serve a legacy agree/disagree question, roughly
 * one in twelve. They are kept for bank depth, but the whole point of the
 * behavioural patterns is that candidates cannot read the desirable answer off
 * a Likert scale — so legacy items stay a garnish, never the meal.
 */
export const LEGACY_SELECTION_RATE = 1 / 12;

// ── Repeat probes ──────────────────────────────────────────────────────────

/**
 * How many questions must pass between a probe question and its reworded twin.
 *
 * The gap is the whole mechanism. Too short and the candidate recognises the
 * repeat, answers it to match, and the pair measures nothing but their memory.
 * Long enough and they meet the situation fresh — which is the only way the
 * second answer is independent evidence about the first.
 *
 * A twin is never served early: the selector holds the group back until the gap
 * has passed, even if that question would otherwise be the best available.
 */
export const PROBE_GAP_QUESTIONS = 8;

/**
 * Most probe pairs one module will open.
 *
 * Every pair spends two of the module's questions on measuring the reliability
 * of one answer rather than on covering new ground. Two is enough to tell a
 * steady candidate from an erratic one; more starts eating the coverage that
 * makes the scores worth checking in the first place.
 */
export const PROBE_MAX_PAIRS = 2;

/**
 * Distance between two trait weights at which their agreement reads as zero.
 *
 * The full span of the authoring scale: an answer at +3 and its twin at -3 are
 * as far apart as this engine can express, and score 0. Identical answers score
 * 1. Matches `CONSISTENCY_ZERO_AT_STDEV`, which is the same statement made about
 * a spread rather than a pair.
 */
export const PROBE_AGREEMENT_ZERO_AT = TRAIT_WEIGHT_MAX - TRAIT_WEIGHT_MIN;

/**
 * Note there is no threshold here for "this pair disagreed". Where the line
 * falls is a reporting decision, so it lives with the other reporting bands as
 * `CONSISTENT_AT` — the engine records the agreement and never acts on it. A
 * flipped probe moves no score, lowers no confidence and ends no module.
 */
