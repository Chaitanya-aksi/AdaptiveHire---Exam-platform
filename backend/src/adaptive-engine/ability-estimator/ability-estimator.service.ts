import { Injectable } from '@nestjs/common';
import {
  ABILITY_PRIOR_SPREAD,
  CONSISTENCY_MIN_SAMPLES,
  CONSISTENCY_ZERO_AT_STDEV,
  ELO_D,
  K_EARLY,
  K_LATE,
  K_QUESTION,
  K_SWITCH_AFTER,
  STABILITY_BAND,
  STABILITY_WINDOW,
  TRAIT_TARGET_QUESTIONS,
  TRAIT_WEIGHT_MAX,
  TRAIT_WEIGHT_MIN,
} from '../adaptive-engine.constants';
import type { ModuleRunState, TraitRange, TraitTally } from '../engine.types';

export interface AbilityUpdate {
  /** The candidate's estimate after this answer. */
  ability: number;
  /** The item's difficulty after this answer — items self-calibrate slowly. */
  questionDifficulty: number;
  /** Probability the model gave this candidate of answering correctly. */
  expected: number;
}

/** A finished trait, on the 0-100 reporting scale. */
export interface TraitScore {
  score: number;
  /** How much evidence there is, 0..1 — answers against the target count. */
  confidence: number;
  /**
   * How consistently the candidate expressed this trait across contexts,
   * 0..1, or null when fewer than two answers touched it.
   *
   * Optional on read: results stored before consistency existed have no value
   * for it, and a missing signal must not read as a measured one.
   */
  consistency?: number | null;
}

/**
 * Elo-style ability estimation, one estimate per module.
 *
 * Both sides of the match move: the candidate's ability by a K that decays
 * after the opening questions, and the item's difficulty by a much smaller K
 * so a question's stored difficulty converges on reality over many candidates.
 *
 * Confidence is the standard error of that same logistic model, expressed as
 * how far it has shrunk from the assumed prior spread. That is error
 * propagation on the curve we already committed to — not IRT calibration:
 * no item parameters beyond difficulty are estimated and nothing is fitted.
 */
@Injectable()
export class AbilityEstimatorService {
  /** P(correct) under the logistic curve, for the report and the selector. */
  expectedScore(ability: number, difficulty: number): number {
    return 1 / (1 + 10 ** ((difficulty - ability) / ELO_D));
  }

  /**
   * One Elo update. `isCorrect` is the actual outcome; everything else is
   * derived. Pure — the caller writes the result back onto the module state.
   */
  update(
    ability: number,
    questionDifficulty: number,
    isCorrect: boolean,
    answeredSoFar: number,
  ): AbilityUpdate {
    const expected = this.expectedScore(ability, questionDifficulty);
    const actual = isCorrect ? 1 : 0;
    const k = answeredSoFar < K_SWITCH_AFTER ? K_EARLY : K_LATE;

    return {
      ability: ability + k * (actual - expected),
      // Mirror image of the candidate's update: the item "wins" when the
      // candidate gets it wrong, and winning pushes its difficulty up.
      questionDifficulty: questionDifficulty + K_QUESTION * (expected - actual),
      expected,
    };
  }

  /**
   * Fisher information this answer contributed, in Elo^-2. Maximal when the
   * question was a coin flip for this candidate (p = 0.5) and near zero when
   * it was far too easy or too hard — which is exactly why a well-matched
   * candidate needs fewer questions to reach the confidence threshold.
   */
  information(ability: number, difficulty: number): number {
    const p = this.expectedScore(ability, difficulty);
    const logitsPerEloPoint = Math.LN10 / ELO_D;
    return p * (1 - p) * logitsPerEloPoint ** 2;
  }

  /** Standard error of the ability estimate, in Elo points. */
  standardError(information: number): number {
    if (information <= 0) return Number.POSITIVE_INFINITY;
    return 1 / Math.sqrt(information);
  }

  /**
   * How precise the estimate is, 0..1 — zero before the first answer,
   * approaching 1 as the standard error shrinks relative to the prior spread.
   *
   * Depends only on which questions were served, not on how they were
   * answered, which is why it is only half of the confidence picture.
   */
  precisionConfidence(state: ModuleRunState): number {
    const se = this.standardError(state.information);
    if (!Number.isFinite(se)) return 0;
    return clamp01(1 - se / ABILITY_PRIOR_SPREAD);
  }

  /**
   * How settled the estimate is, 0..1 — how little it has moved across the
   * last few answers. Zero until the window is full: a short run of answers
   * looks stable for the wrong reason.
   */
  stabilityConfidence(state: ModuleRunState): number {
    const window = state.recentAbilities.slice(-STABILITY_WINDOW);
    if (window.length < STABILITY_WINDOW) return 0;

    const spread = Math.max(...window) - Math.min(...window);
    return clamp01(1 - spread / STABILITY_BAND);
  }

  /** Both halves must hold, so the weaker one governs. */
  abilityConfidence(state: ModuleRunState): number {
    return Math.min(
      this.precisionConfidence(state),
      this.stabilityConfidence(state),
    );
  }

  /** Appends an estimate to the trailing window, trimming it in place. */
  trackAbility(state: ModuleRunState, ability: number): void {
    state.recentAbilities.push(ability);
    if (state.recentAbilities.length > STABILITY_WINDOW) {
      state.recentAbilities.splice(
        0,
        state.recentAbilities.length - STABILITY_WINDOW,
      );
    }
  }

  /**
   * Folds one answered trait question into the running tallies (in place).
   *
   * `weights` is what the candidate's answer expressed. `ranges` is what the
   * question made possible, and covers every trait the question *could* have
   * expressed — a wider set, because an option that stays silent on a trait is
   * still one of the answers on offer. Passing up the chance to express a trait
   * has to move that trait's scale, or only the options that mention a trait
   * ever reach its score, which is the authoring skew this exists to remove.
   *
   * Omit `ranges` for an answer with no choice behind it (a question the clock
   * ran out on): there was no chance to take, and charging the candidate the
   * chance value for it would read as having answered it badly.
   *
   * `count` and `sumSquares` deliberately move only with `weights`. They
   * measure how often the candidate actually expressed the trait and how
   * steadily — which is what confidence, coverage and consistency each ask, and
   * none of those questions changed. Only the score's scale did.
   */
  applyTraitWeights(
    tallies: Record<string, TraitTally>,
    weights: Record<string, number>,
    ranges?: Record<string, TraitRange>,
  ): void {
    for (const [trait, weight] of Object.entries(weights)) {
      const tally = (tallies[trait] ??= { sum: 0, count: 0, sumSquares: 0 });
      tally.sum += weight;
      tally.count += 1;
      // `?? 0` because a session state serialised before consistency existed
      // has no sumSquares; treating it as zero degrades the signal rather
      // than producing NaN.
      tally.sumSquares = (tally.sumSquares ?? 0) + weight * weight;
    }

    for (const [trait, range] of Object.entries(ranges ?? {})) {
      const tally = (tallies[trait] ??= { sum: 0, count: 0, sumSquares: 0 });
      tally.chanceSum = (tally.chanceSum ?? 0) + range.chance;
      tally.bestSum = (tally.bestSum ?? 0) + range.best;
      tally.worstSum = (tally.worstSum ?? 0) + range.worst;
    }
  }

  /**
   * How consistently a candidate answered on one trait, 0..1, or null when
   * there is not enough evidence to say.
   *
   * This is the behavioural engine's answer to "did they tell us the same
   * thing in different contexts?". Someone who chooses the collaborative
   * option when a teammate is struggling but the solitary one when they are
   * struggling themselves has contributed two very different weights to
   * Teamwork, and this is what notices.
   *
   * It is emphatically NOT a lie detector. Low consistency means the trait was
   * expressed differently across situations — which is ordinary human
   * behaviour, and is reported as a caveat on the score, never as dishonesty.
   */
  traitConsistency(tally: TraitTally | undefined): number | null {
    if (!tally || tally.count < CONSISTENCY_MIN_SAMPLES) return null;

    const mean = tally.sum / tally.count;
    // Clamped at zero: floating-point error can make this fractionally
    // negative when every contribution was identical.
    const variance = Math.max(
      0,
      (tally.sumSquares ?? 0) / tally.count - mean * mean,
    );

    return round2(clamp01(1 - Math.sqrt(variance) / CONSISTENCY_ZERO_AT_STDEV));
  }

  /**
   * Consistency across the whole profile — the mean of the traits that have
   * enough evidence to be measured, or null when none do.
   */
  overallConsistency(state: ModuleRunState): number | null {
    const measured = Object.values(state.traitTallies)
      .map((tally) => this.traitConsistency(tally))
      .filter((value): value is number => value !== null);

    if (measured.length === 0) return null;

    const total = measured.reduce((sum, value) => sum + value, 0);
    return round2(total / measured.length);
  }

  /** How well covered one trait is: answers so far against the target. */
  traitConfidence(tally: TraitTally | undefined): number {
    if (!tally || tally.count === 0) return 0;
    return clamp01(tally.count / TRAIT_TARGET_QUESTIONS);
  }

  /**
   * Final per-trait scores. A trait with no answers is reported at the neutral
   * midpoint with zero confidence rather than being dropped, so the report can
   * say "not enough signal" instead of silently omitting it.
   */
  traitScores(state: ModuleRunState): Record<string, TraitScore> {
    const scores: Record<string, TraitScore> = {};

    const keys = state.traits.length
      ? state.traits.map((trait) => trait.key)
      : Object.keys(state.traitTallies);

    for (const key of keys) {
      const tally = state.traitTallies[key];
      scores[key] = {
        score: round1(this.traitScore(tally)),
        confidence: round2(this.traitConfidence(tally)),
        consistency: this.traitConsistency(tally),
      };
    }

    return scores;
  }

  /**
   * One trait on the 0-100 reporting scale, measured against what the questions
   * this candidate was actually served made possible.
   *
   * 50 is what answering at random earns, 100 is picking the most indicative
   * option every time and 0 the least. Anchoring on the questions rather than
   * on the fixed authoring range is the whole point: option sets are written
   * positive-skewed — across the starter bank the mean option weight is about
   * +0.6 rather than 0, because most questions offer several reasonable
   * behaviours and one poor one — so a fixed -3..+3 scale handed a random
   * responder about 59/100 and presented it as a result.
   *
   * One straight line, scaled by whichever side of `chance` has more room in
   * it. Scaling each side to its own half separately is the obvious
   * alternative and is wrong: `best` and `worst` are rarely symmetric about
   * `chance`, so two slopes make the mapping non-linear, and a non-linear
   * mapping does not carry the mean through it — a random responder comes out
   * at 56 rather than 50, which is the one number this exists to fix. A single
   * slope keeps the transform linear, and a linear transform of `sum` puts
   * `E[random]` exactly on 50 whatever the bank looks like.
   *
   * The price is that the far end of the narrower side stops short of its
   * extreme: on a question offering +3/+2/0/-3 there is more room to answer
   * badly than well, so answering it as well as possible scores below 100.
   * That is the honest reading — the scale says how far from chance the
   * answers went, and that question does not offer as far up as it does down.
   */
  traitScore(tally: TraitTally | undefined): number {
    if (
      tally?.chanceSum === undefined ||
      tally.bestSum === undefined ||
      tally.worstSum === undefined
    ) {
      return this.legacyTraitScore(tally);
    }

    const { sum, chanceSum, bestSum, worstSum } = tally;
    const spread = Math.max(bestSum - chanceSum, chanceSum - worstSum);

    // Questions that offered no choice on this trait at all: every answer led
    // to the same contribution, so there is nothing to place on a scale.
    if (spread <= 0) return 50;

    // `sum` cannot leave `worstSum..bestSum`, so this cannot leave 0..100.
    // Clamped anyway: a hand-edited stored tally should not surface as 108.
    return clamp(50 + 50 * ((sum - chanceSum) / spread), 0, 100);
  }

  /**
   * The pre-normalisation scale: the mean weight rescaled from the fixed
   * authoring range.
   *
   * Kept for tallies recorded before per-item normalisation existed — a stored
   * result or an in-flight Redis session carries no `chanceSum`, and rescoring
   * it on a scale its questions were never measured against would change
   * numbers a recruiter has already read. New runs never reach this.
   */
  private legacyTraitScore(tally: TraitTally | undefined): number {
    const mean = tally && tally.count > 0 ? tally.sum / tally.count : 0;
    const range = TRAIT_WEIGHT_MAX - TRAIT_WEIGHT_MIN;
    // Clamped: a weight authored outside the declared range would otherwise
    // report as e.g. 125/100, which reads as a real score.
    return clamp01((mean - TRAIT_WEIGHT_MIN) / range) * 100;
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
