import { BadRequestException, Injectable } from '@nestjs/common';
import { ScoringType } from '../../common/enums';
import type { McqQuestionDetails } from '../../question-bank/entities/mcq-question-details.entity';
import type { PersonalityQuestionDetails } from '../../question-bank/entities/personality-question-details.entity';
import { rankingPositionFactor } from '../adaptive-engine.constants';
import type { EvaluationResult } from '../engine.types';

/**
 * Scores one submitted answer. Deliberately knows nothing about the running
 * ability estimate — it answers only "what did this answer mean?", and the
 * ability estimator decides what that does to the score.
 */
@Injectable()
export class EvaluationService {
  /** Objective module: right or wrong against the stored correct option. */
  evaluateMcq(
    details: McqQuestionDetails,
    selectedOption: string,
  ): EvaluationResult {
    this.assertKnownOption(
      details.options.map((option) => option.key),
      selectedOption,
    );

    return {
      isCorrect: selectedOption === details.correctOption,
      traitWeights: {},
    };
  }

  /** Trait module: the chosen option's weights are the whole result. */
  evaluatePersonality(
    details: PersonalityQuestionDetails,
    selectedOption: string,
  ): EvaluationResult {
    const chosen = details.options.find(
      (option) => option.key === selectedOption,
    );
    if (!chosen) {
      this.assertKnownOption(
        details.options.map((option) => option.key),
        selectedOption,
      );
    }

    return {
      isCorrect: null,
      traitWeights: { ...(chosen?.traitWeights ?? {}) },
    };
  }

  /**
   * Ranking question: the candidate's ordering is the answer.
   *
   * Every option's weights are applied, scaled by where it was placed — full
   * strength at the top, the same magnitude negated at the bottom. Ranking
   * something last is a statement about the candidate, not an absence of one.
   *
   * The ordering must be complete and free of duplicates. A partial ranking
   * cannot be scored (the unplaced options have no position), and a duplicate
   * would double-count one option while leaving another unscored, so both are
   * rejected rather than repaired.
   */
  evaluateRanking(
    details: PersonalityQuestionDetails,
    orderedKeys: string[],
  ): EvaluationResult {
    const validKeys = details.options.map((option) => option.key);

    const duplicates = orderedKeys.filter(
      (key, index) => orderedKeys.indexOf(key) !== index,
    );
    if (duplicates.length > 0) {
      throw new BadRequestException(
        `Each option may be ranked once; "${[...new Set(duplicates)].join(
          ', ',
        )}" appears more than once`,
      );
    }

    for (const key of orderedKeys) this.assertKnownOption(validKeys, key);

    if (orderedKeys.length !== validKeys.length) {
      const missing = validKeys.filter((key) => !orderedKeys.includes(key));
      throw new BadRequestException(
        `Rank all ${validKeys.length} options; ${missing.length} still ` +
          `unplaced (${missing.join(', ')})`,
      );
    }

    const totals: Record<string, { sum: number; count: number }> = {};
    orderedKeys.forEach((key, position) => {
      const option = details.options.find((o) => o.key === key);
      if (!option) return;

      const factor = rankingPositionFactor(position, orderedKeys.length);
      for (const [trait, weight] of Object.entries(option.traitWeights)) {
        const total = (totals[trait] ??= { sum: 0, count: 0 });
        total.sum += weight * factor;
        total.count += 1;
      }
    });

    // Averaged, not summed. A trait carried by several options would otherwise
    // contribute several times the scale a single-choice answer can — one
    // ranking would outweigh three situational questions. Averaging keeps
    // every question's contribution on the same -3..+3 footing, so the mix of
    // patterns a candidate happens to be served cannot skew their profile.
    const traitWeights: Record<string, number> = {};
    for (const [trait, { sum, count }] of Object.entries(totals)) {
      traitWeights[trait] = sum / count;
    }

    return { isCorrect: null, traitWeights };
  }

  /**
   * Skipped/unanswered question (module timed out with one on screen). Counts
   * as a wrong answer for objective modules and contributes nothing to traits.
   */
  evaluateUnanswered(scoringType: ScoringType): EvaluationResult {
    return {
      isCorrect: scoringType === ScoringType.OBJECTIVE ? false : null,
      traitWeights: {},
    };
  }

  private assertKnownOption(
    validKeys: string[],
    selected: string,
  ): never | void {
    if (validKeys.includes(selected)) return;
    throw new BadRequestException(
      `"${selected}" is not one of this question's options (${validKeys.join(
        ', ',
      )})`,
    );
  }
}
