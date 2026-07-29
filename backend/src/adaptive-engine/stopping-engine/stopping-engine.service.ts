import { Injectable } from '@nestjs/common';
import { ModuleStopReason, ScoringType } from '../../common/enums';
import {
  ABILITY_CONFIDENCE_THRESHOLD,
  TRAIT_CONFIDENCE_THRESHOLD,
} from '../adaptive-engine.constants';
import { AbilityEstimatorService } from '../ability-estimator/ability-estimator.service';
import type { ModuleRunState } from '../engine.types';

export interface StopDecision {
  stop: boolean;
  reason: ModuleStopReason | null;
}

const CONTINUE: StopDecision = { stop: false, reason: null };

/**
 * Decides when a module has learned enough about the candidate.
 *
 * This is what produces "not everyone gets the same number of questions": a
 * candidate whose ability the questions pin down quickly hits the confidence
 * threshold early, an erratic or extreme one runs closer to the maximum. The
 * configured minimum always wins over confidence, so nobody is judged on two
 * lucky answers.
 */
@Injectable()
export class StoppingEngineService {
  constructor(private readonly estimator: AbilityEstimatorService) {}

  shouldStop(state: ModuleRunState, now = Date.now()): StopDecision {
    // The clock is server-authoritative and outranks everything else.
    if (state.deadlineAt !== null && now >= state.deadlineAt) {
      return { stop: true, reason: ModuleStopReason.TIME_EXPIRED };
    }

    if (state.answered >= state.maxQuestions) {
      return { stop: true, reason: ModuleStopReason.MAX_QUESTIONS };
    }

    if (state.answered < state.minQuestions) return CONTINUE;

    return this.confidence(state) >= this.threshold(state)
      ? { stop: true, reason: ModuleStopReason.CONFIDENCE_REACHED }
      : CONTINUE;
  }

  /**
   * How settled the module's result is, 0..1.
   *
   * Objective modules have one estimate to settle. Trait modules have one per
   * trait and take the *weakest* of them — a profile is only as trustworthy as
   * its thinnest trait.
   */
  confidence(state: ModuleRunState): number {
    if (state.scoringType === ScoringType.OBJECTIVE) {
      return this.estimator.abilityConfidence(state);
    }

    const keys = state.traits.length
      ? state.traits.map((trait) => trait.key)
      : Object.keys(state.traitTallies);
    if (keys.length === 0) return 0;

    return Math.min(
      ...keys.map((key) =>
        this.estimator.traitConfidence(state.traitTallies[key]),
      ),
    );
  }

  private threshold(state: ModuleRunState): number {
    return state.scoringType === ScoringType.OBJECTIVE
      ? ABILITY_CONFIDENCE_THRESHOLD
      : TRAIT_CONFIDENCE_THRESHOLD;
  }
}
