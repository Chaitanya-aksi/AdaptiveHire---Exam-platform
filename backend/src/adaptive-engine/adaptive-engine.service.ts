import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BehavioralPattern,
  ModuleStopReason,
  ScoringType,
} from '../common/enums';
import type { TraitDefinition } from '../modules-catalog/entities/module.entity';
import { McqQuestionDetails } from '../question-bank/entities/mcq-question-details.entity';
import { PersonalityQuestionDetails } from '../question-bank/entities/personality-question-details.entity';
import { STARTING_ABILITY } from './adaptive-engine.constants';
import {
  AbilityEstimatorService,
  type TraitScore,
} from './ability-estimator/ability-estimator.service';
import { ConsistencyProbeService } from './consistency-probe/consistency-probe.service';
import type {
  ModuleRunState,
  ProbeResults,
  ProbeSignature,
} from './engine.types';
import { EvaluationService } from './evaluation/evaluation.service';
import {
  QuestionSelectorService,
  type SelectedQuestion,
} from './question-selector/question-selector.service';
import { StoppingEngineService } from './stopping-engine/stopping-engine.service';

/** Config copied out of `assessment_modules` when a session starts. */
export interface ModuleRunConfig {
  moduleId: string;
  /** The owning organisation, which scopes the questions the selector may serve. */
  organisationId: string;
  assessmentId: string;
  /** Whether this assessment has a curated pool to draw from. */
  poolRestricted: boolean;
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

/**
 * What the candidate submitted. Explicit about its shape so the engine never
 * has to infer "was this a ranking?" from a nullable string.
 */
export type SubmittedAnswer =
  | { kind: 'option'; selectedOption: string }
  | { kind: 'ranking'; selectedOptions: string[] }
  /** The module's clock ran out with the question still on screen. */
  | { kind: 'unanswered' };

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
    private readonly probes: ConsistencyProbeService,
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
      patternCounts: {},
      probes: [],
      servedProbeGroups: [],
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
      // The bank ran dry. Ending the module is the honest outcome; the reason
      // records whether that cost anything.
      //
      // A module already past its confidence threshold was only still open to
      // close a repeat probe, so it ended settled — calling that "pool
      // exhausted" would tell a recruiter the score rests on fewer answers than
      // intended when it does not. Below the threshold it genuinely does.
      return {
        kind: 'module_complete',
        reason: this.stopping.thresholdMet(state)
          ? ModuleStopReason.CONFIDENCE_REACHED
          : ModuleStopReason.POOL_EXHAUSTED,
      };
    }

    return { kind: 'question', question };
  }

  /**
   * Scores one answer and folds it into the module state.
   *
   * `sequenceNumber` is the answer's position in the whole session. It is not
   * used for scoring — it is carried so a repeat probe can tell the recruiter
   * which two rows of the answer list make up a pair.
   */
  async recordAnswer(
    state: ModuleRunState,
    question: SelectedQuestion,
    answer: SubmittedAnswer,
    sequenceNumber: number,
  ): Promise<AnswerOutcome> {
    return state.scoringType === ScoringType.OBJECTIVE
      ? this.recordObjectiveAnswer(state, question, answer, sequenceNumber)
      : this.recordTraitAnswer(state, question, answer, sequenceNumber);
  }

  /**
   * Notes that a probe question has been put on screen, so its twin stays out
   * of the paper until the gap has passed.
   *
   * Called at serve time rather than answer time: a question the candidate
   * walks away from has still been seen, and its twin would still read as a
   * repeat.
   */
  markProbeServed(
    state: ModuleRunState,
    question: { probeGroup: string | null },
  ): void {
    if (question.probeGroup) {
      this.probes.markServed(state, question.probeGroup);
    }
  }

  /**
   * Replays one stored answer's probe bookkeeping while session state is being
   * rebuilt from the database.
   *
   * Takes the signature ready-made because the caller has already re-derived
   * what the answer meant — for a trait answer that means running it back
   * through the evaluation service, since a ranking's weights depend on the
   * position of every option and cannot be read off a single stored column.
   */
  replayProbe(
    state: ModuleRunState,
    question: { id: string; probeGroup: string | null },
    sequenceNumber: number,
    signature: ProbeSignature,
  ): void {
    this.markProbeServed(state, question);
    this.registerProbe(state, question, sequenceNumber, signature);
  }

  /**
   * Opens or closes this question's probe pair, if it belongs to one.
   *
   * Runs after the answer has been scored and `state.answered` incremented, so
   * the gap is measured from the question that follows this one.
   */
  private registerProbe(
    state: ModuleRunState,
    question: { id: string; probeGroup: string | null },
    sequenceNumber: number,
    signature: ProbeSignature,
  ): void {
    if (!question.probeGroup) return;
    this.probes.record(
      state,
      question.probeGroup,
      question.id,
      sequenceNumber,
      signature,
    );
  }

  private async recordObjectiveAnswer(
    state: ModuleRunState,
    question: SelectedQuestion,
    answer: SubmittedAnswer,
    sequenceNumber: number,
  ): Promise<AnswerOutcome> {
    const details = question.mcqDetails;
    if (!details) {
      throw new Error(
        `Question ${question.id} is in an objective module but has no MCQ details`,
      );
    }
    if (answer.kind === 'ranking') {
      throw new BadRequestException(
        'This question takes a single answer, not a ranking',
      );
    }

    const result =
      answer.kind === 'unanswered'
        ? this.evaluation.evaluateUnanswered(state.scoringType)
        : this.evaluation.evaluateMcq(details, answer.selectedOption);
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

    this.registerProbe(
      state,
      question,
      sequenceNumber,
      this.probes.signature(
        state.scoringType,
        { isCorrect, traitWeights: {} },
        answer.kind !== 'unanswered',
      ),
    );

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
    answer: SubmittedAnswer,
    sequenceNumber: number,
  ): Promise<AnswerOutcome> {
    const details = question.personalityDetails;
    if (!details) {
      throw new Error(
        `Question ${question.id} is in a trait module but has no personality details`,
      );
    }
    this.assertAnswerShape(details, answer);

    const result =
      answer.kind === 'unanswered'
        ? this.evaluation.evaluateUnanswered(state.scoringType)
        : answer.kind === 'ranking'
          ? this.evaluation.evaluateRanking(details, answer.selectedOptions)
          : this.evaluation.evaluatePersonality(details, answer.selectedOption);

    this.estimator.applyTraitWeights(state.traitTallies, result.traitWeights);
    state.answered += 1;
    // Counted even when unanswered: the pattern was put to the candidate, and
    // serving the same shape again would not balance the coverage.
    if (details.pattern) {
      state.patternCounts[details.pattern] =
        (state.patternCounts[details.pattern] ?? 0) + 1;
    }

    this.registerProbe(
      state,
      question,
      sequenceNumber,
      this.probes.signature(
        state.scoringType,
        { isCorrect: null, traitWeights: result.traitWeights },
        answer.kind !== 'unanswered',
      ),
    );

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

  /**
   * A ranking question needs an ordering and every other shape needs a single
   * choice. Rejecting the mismatch here means a client that renders the wrong
   * widget fails loudly rather than silently recording a mis-scored answer.
   */
  private assertAnswerShape(
    details: PersonalityQuestionDetails,
    answer: SubmittedAnswer,
  ): void {
    if (answer.kind === 'unanswered') return;

    const isRanking = details.pattern === BehavioralPattern.RANKING;
    if (isRanking && answer.kind !== 'ranking') {
      throw new BadRequestException(
        'This question must be answered by ranking every option',
      );
    }
    if (!isRanking && answer.kind === 'ranking') {
      throw new BadRequestException(
        'This question takes a single choice, not a ranking',
      );
    }
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

  /**
   * How consistently the candidate answered across contexts, 0..1, or null
   * when no trait has enough evidence. Trait modules only.
   */
  overallConsistency(state: ModuleRunState): number | null {
    return state.scoringType === ScoringType.TRAIT
      ? this.estimator.overallConsistency(state)
      : null;
  }

  /**
   * The module's repeat-probe outcome, or null when no pair was opened.
   *
   * Both scoring types can have one: an objective module's pairs check whether a
   * right answer was knowledge, a trait module's whether a choice holds up in a
   * second framing.
   */
  probeResults(state: ModuleRunState): ProbeResults | null {
    return this.probes.results(state);
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
