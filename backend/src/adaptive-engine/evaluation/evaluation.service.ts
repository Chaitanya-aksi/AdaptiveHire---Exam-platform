import { BadRequestException, Injectable } from '@nestjs/common';
import { ScoringType } from '../../common/enums';
import type { McqQuestionDetails } from '../../question-bank/entities/mcq-question-details.entity';
import type { PersonalityQuestionDetails } from '../../question-bank/entities/personality-question-details.entity';
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
