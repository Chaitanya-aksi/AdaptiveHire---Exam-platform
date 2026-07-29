import type { ModuleStopReason, ScoringType } from '../common/enums';
import type { TraitDefinition } from '../modules-catalog/entities/module.entity';

/**
 * The adaptive state of one module inside one candidate's run. This is the
 * only thing the four engine services read and write — they never touch Redis
 * or the database, which is what makes them unit-testable in isolation.
 */
export interface ModuleRunState {
  moduleId: string;
  slug: string;
  name: string;
  description: string | null;
  scoringType: ScoringType;
  /** Copied from `assessment_modules` at session start so mid-run config
   * changes can't alter a paper already in progress. */
  minQuestions: number;
  maxQuestions: number;
  timeLimitSeconds: number;
  /** Trait definitions from the module catalogue; empty for objective modules. */
  traits: TraitDefinition[];

  status: ModuleRunStatus;
  /** Epoch ms. Null until the candidate reaches this module. */
  startedAt: number | null;
  /** Epoch ms; `startedAt + timeLimitSeconds`. The server-authoritative clock. */
  deadlineAt: number | null;
  completedAt: number | null;
  stopReason: ModuleStopReason | null;

  answered: number;
  correct: number;
  /** Ids already served in this module — the "no revisiting" guarantee. */
  seenQuestionIds: string[];

  /** Elo-scale estimate. Meaningful for objective modules only. */
  ability: number;
  /**
   * Accumulated Fisher information of the answers so far, in Elo^-2 units.
   * Standard error is `1 / sqrt(information)`; see AbilityEstimatorService.
   */
  information: number;

  /** Trailing ability estimates, newest last — the stability check's input. */
  recentAbilities: number[];

  /** trait key -> running tally. Meaningful for trait modules only. */
  traitTallies: Record<string, TraitTally>;
}

export type ModuleRunStatus = 'pending' | 'in_progress' | 'completed';

export interface TraitTally {
  /** Sum of the option weights picked for this trait. */
  sum: number;
  /** How many questions have contributed to it. */
  count: number;
}

/** What the evaluation service produces for one submitted answer. */
export interface EvaluationResult {
  /** Null for trait modules — there is no right answer there. */
  isCorrect: boolean | null;
  /** trait key -> weight contributed. Empty for objective modules. */
  traitWeights: Record<string, number>;
}
