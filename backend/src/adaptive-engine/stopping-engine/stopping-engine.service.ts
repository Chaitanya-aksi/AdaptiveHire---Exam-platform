import { Injectable } from '@nestjs/common';
import { ModuleStopReason, ScoringType } from '../../common/enums';
import {
  ABILITY_CONFIDENCE_THRESHOLD,
  TRAIT_CONFIDENCE_THRESHOLD,
} from '../adaptive-engine.constants';
import { AbilityEstimatorService } from '../ability-estimator/ability-estimator.service';
import { ConsistencyProbeService } from '../consistency-probe/consistency-probe.service';
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
  constructor(
    private readonly estimator: AbilityEstimatorService,
    private readonly probes: ConsistencyProbeService,
  ) {}

  shouldStop(state: ModuleRunState, now = Date.now()): StopDecision {
    // The clock is server-authoritative and outranks everything else.
    if (state.deadlineAt !== null && now >= state.deadlineAt) {
      return { stop: true, reason: ModuleStopReason.TIME_EXPIRED };
    }

    /*
     * The only ordinary way a section ends.
     *
     * There used to be a second: once the ability estimate was settled enough,
     * the module stopped early, somewhere between a configured minimum and
     * maximum. That is gone (2026-08-24) — sections are a fixed length now, so
     * every candidate answers the same number of questions and two results are
     * directly comparable. `CONFIDENCE_REACHED` is therefore no longer
     * produced; it stays in the enum because completed attempts still carry it.
     *
     * The test is still adaptive. `thresholdMet` below still measures how
     * settled a result is, and the selector still matches each question to the
     * running estimate — what changed is that being settled no longer buys the
     * candidate an early finish.
     */
    if (state.answered >= state.questionCount) {
      return { stop: true, reason: ModuleStopReason.MAX_QUESTIONS };
    }

    return CONTINUE;
  }

  /**
   * Whether the module has earned its confidence stop — enough answers, and a
   * settled enough result.
   *
   * Public because the orchestrator needs it when the question pool runs dry: a
   * module that was already settled and only being held open to close a probe
   * ended because it was finished, not because the bank ran out.
   */
  thresholdMet(state: ModuleRunState): boolean {
    if (state.answered === 0) return false;
    return this.confidence(state) >= this.threshold(state);
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
