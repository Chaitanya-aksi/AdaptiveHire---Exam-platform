import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModuleStopReason, ScoringType } from '../common/enums';
import type { TraitDefinition } from '../modules-catalog/entities/module.entity';
import { McqQuestionDetails } from '../question-bank/entities/mcq-question-details.entity';
import { PersonalityQuestionDetails } from '../question-bank/entities/personality-question-details.entity';
import { STARTING_ABILITY } from './adaptive-engine.constants';
import {
  AbilityEstimatorService,
  type TraitScore,
} from './ability-estimator/ability-estimator.service';
import type { ModuleRunState } from './engine.types';
import { EvaluationService } from './evaluation/evaluation.service';
import {
  QuestionSelectorService,
  type SelectedQuestion,
} from './question-selector/question-selector.service';
import { StoppingEngineService } from './stopping-engine/stopping-engine.service';

/** Config copied out of `assessment_modules` when a session starts. */
export interface ModuleRunConfig {
  moduleId: string;
  slug: string;
  name: string;
  description: string | null;
  scoringType: ScoringType;
  traits: TraitDefinition[];
  minQuestions: number;
  maxQuestions: number;
  timeLimitSeconds: number;
}

export type NextStep =
  | { kind: 'question'; question: SelectedQuestion }
  | { kind: 'module_complete'; reason: ModuleStopReason };

export interface AnswerOutcome {
  isCorrect: boolean | null;
  /** Snapshot of the item's difficulty when it was served. Objective only. */
  questionDifficultyAtServe: number | null;
  /** The running estimate after this answer. Objective only. */
  abilityEstimateAfter: number | null;
}

/**
 * Orchestrates the four engine services. Everything the engine knows about a
 * candidate lives in the `ModuleRunState` it is handed — it reads and mutates
 * that object and never touches the session store, so the whole engine can be
 * driven from a unit test with a plain object.
 */
@Injectable()
export class AdaptiveEngineService {
  constructor(
    private readonly evaluation: EvaluationService,
    private readonly estimator: AbilityEstimatorService,
    private readonly selector: QuestionSelectorService,
    private readonly stopping: StoppingEngineService,
    @InjectRepository(McqQuestionDetails)
    private readonly mcqDetails: Repository<McqQuestionDetails>,
    @InjectRepository(PersonalityQuestionDetails)
    private readonly personalityDetails: Repository<PersonalityQuestionDetails>,
  ) {}

  /** Fresh state for one module of one candidate's run. */
  createModuleState(config: ModuleRunConfig): ModuleRunState {
    return {
      ...config,
      status: 'pending',
      startedAt: null,
      deadlineAt: null,
      completedAt: null,
      stopReason: null,
      answered: 0,
      correct: 0,
      seenQuestionIds: [],
      ability: STARTING_ABILITY,
      information: 0,
      recentAbilities: [],
      traitTallies: {},
    };
  }

  /**
   * Either the next question to serve or the reason this module is over.
   * The stopping engine is consulted first so a module that has already met
   * its threshold never serves one more question than it needs.
   */
  async nextStep(state: ModuleRunState, now = Date.now()): Promise<NextStep> {
    const decision = this.stopping.shouldStop(state, now);
    if (decision.stop) {
      return {
        kind: 'module_complete',
        reason: decision.reason ?? ModuleStopReason.MAX_QUESTIONS,
      };
    }

    const question = await this.selector.selectNext(state);
    if (!question) {
      // The bank ran dry before the minimum was met. Ending the module is the
      // honest outcome; the result carries the reason so a recruiter can see
      // the score rests on fewer answers than intended.
      return {
        kind: 'module_complete',
        reason: ModuleStopReason.POOL_EXHAUSTED,
      };
    }

    return { kind: 'question', question };
  }

  /**
   * Scores one answer and folds it into the module state. `selectedOption` is
   * null when the module's clock ran out with a question on screen.
   */
  async recordAnswer(
    state: ModuleRunState,
    question: SelectedQuestion,
    selectedOption: string | null,
  ): Promise<AnswerOutcome> {
    return state.scoringType === ScoringType.OBJECTIVE
      ? this.recordObjectiveAnswer(state, question, selectedOption)
      : this.recordTraitAnswer(state, question, selectedOption);
  }

  private async recordObjectiveAnswer(
    state: ModuleRunState,
    question: SelectedQuestion,
    selectedOption: string | null,
  ): Promise<AnswerOutcome> {
    const details = question.mcqDetails;
    if (!details) {
      throw new Error(
        `Question ${question.id} is in an objective module but has no MCQ details`,
      );
    }

    const result =
      selectedOption === null
        ? this.evaluation.evaluateUnanswered(state.scoringType)
        : this.evaluation.evaluateMcq(details, selectedOption);
    const isCorrect = result.isCorrect === true;

    const difficultyAtServe = details.difficultyScore;
    const abilityBefore = state.ability;
    const update = this.estimator.update(
      abilityBefore,
      difficultyAtServe,
      isCorrect,
      state.answered,
    );

    state.ability = update.ability;
    // Measured at the estimate the question was *chosen* against: it captures
    // how much this question could tell us, not how much the next one would.
    state.information += this.estimator.information(
      abilityBefore,
      difficultyAtServe,
    );
    this.estimator.trackAbility(state, update.ability);
    state.answered += 1;
    if (isCorrect) state.correct += 1;

    await this.mcqDetails.update(
      { questionId: question.id },
      {
        difficultyScore: Math.round(update.questionDifficulty),
        timesUsed: () => '"timesUsed" + 1',
        timesCorrect: () => `"timesCorrect" + ${isCorrect ? 1 : 0}`,
      },
    );

    return {
      isCorrect,
      questionDifficultyAtServe: difficultyAtServe,
      abilityEstimateAfter: round2(state.ability),
    };
  }

  private async recordTraitAnswer(
    state: ModuleRunState,
    question: SelectedQuestion,
    selectedOption: string | null,
  ): Promise<AnswerOutcome> {
    const details = question.personalityDetails;
    if (!details) {
      throw new Error(
        `Question ${question.id} is in a trait module but has no personality details`,
      );
    }

    const result =
      selectedOption === null
        ? this.evaluation.evaluateUnanswered(state.scoringType)
        : this.evaluation.evaluatePersonality(details, selectedOption);

    this.estimator.applyTraitWeights(state.traitTallies, result.traitWeights);
    state.answered += 1;

    await this.personalityDetails.update(
      { questionId: question.id },
      { timesUsed: () => '"timesUsed" + 1' },
    );

    return {
      isCorrect: null,
      questionDifficultyAtServe: null,
      abilityEstimateAfter: null,
    };
  }

  /** Final ability for an objective module, rounded for storage. */
  finalAbility(state: ModuleRunState): number | null {
    return state.scoringType === ScoringType.OBJECTIVE
      ? round2(state.ability)
      : null;
  }

  /** Final trait profile for a trait module. */
  finalTraitScores(state: ModuleRunState): Record<string, TraitScore> | null {
    return state.scoringType === ScoringType.TRAIT
      ? this.estimator.traitScores(state)
      : null;
  }

  /** How settled this module's result is, 0..1 — surfaced in the report. */
  confidence(state: ModuleRunState): number {
    return this.stopping.confidence(state);
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
