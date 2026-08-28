import type { ModuleStopReason, ScoringType } from '../common/enums';
import type { TraitDefinition } from '../modules-catalog/entities/module.entity';

/**
 * The adaptive state of one module inside one candidate's run. This is the
 * only thing the four engine services read and write — they never touch Redis
 * or the database, which is what makes them unit-testable in isolation.
 */
export interface ModuleRunState {
  moduleId: string;
  /**
   * The organisation whose assessment this run belongs to — the scope the
   * selector draws questions from.
   *
   * Without it the selector filtered only on module and status, which meant one
   * customer's private questions were eligible to be served to another
   * customer's candidates. A candidate has no organisation of their own, so this
   * is the assessment's, copied in at session start.
   */
  organisationId: string;
  /** The assessment being sat — the scope of the curated question pool, if any. */
  assessmentId: string;
  /**
   * True when the recruiter has curated a question pool for this assessment.
   *
   * Resolved once at session start rather than checked per selection: absence of
   * pool rows means "no restriction", so without this flag every query would need
   * a second subquery just to discover there was nothing to restrict.
   */
  poolRestricted: boolean;
  slug: string;
  name: string;
  description: string | null;
  scoringType: ScoringType;
  /** Copied from `assessment_modules` at session start so mid-run config
   * changes can't alter a paper already in progress. */
  /** Exactly how many questions this section asks. */
  questionCount: number;
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

  /**
   * behavioural pattern -> how many of its questions have been served.
   *
   * Trait modules only. The selector spreads questions across the patterns so
   * a profile does not rest entirely on, say, ranking answers — different
   * shapes elicit different things, and a candidate who games one still has
   * to face the others.
   */
  patternCounts: Record<string, number>;

  /**
   * Repeat probes opened in this module, in the order they were opened.
   *
   * Both scoring types use these. A pair is opened when a question carrying a
   * `probeGroup` is answered, and closed when its reworded twin is answered
   * `PROBE_GAP_QUESTIONS` later. Purely observational — nothing in here moves an
   * ability estimate or a trait score.
   */
  probes: ProbePair[];

  /**
   * Every `probeGroup` this module has served a question from.
   *
   * Wider than the groups in `probes`, and deliberately so: a module that has
   * already opened its quota of pairs still serves probe questions as ordinary
   * ones, and their twins must stay out of the paper. Without this, a candidate
   * could meet an obvious near-duplicate with nothing being measured by it.
   */
  servedProbeGroups: string[];
}

export type ModuleRunStatus = 'pending' | 'in_progress' | 'completed';

export interface TraitTally {
  /** Sum of the option weights picked for this trait. */
  sum: number;
  /** How many questions have contributed to it. */
  count: number;
  /**
   * Sum of the squares of those weights.
   *
   * Variance is `sumSquares / count - mean^2`, so consistency can be measured
   * without keeping every individual sample — which matters because this whole
   * object is serialised into Redis on every answer.
   */
  sumSquares: number;

  /*
   * The three below scale `sum` onto 0-100. They accumulate over every
   * question that *could* express this trait, which is a wider set than the
   * answers that actually did — see `applyTraitWeights` for why that
   * difference is the whole point.
   *
   * All optional: a tally serialised before per-item normalisation existed has
   * no value for them, and those results fall back to the fixed authoring
   * range. A missing scale must not read as a measured one.
   */

  /**
   * Sum of what a uniformly random answer would have contributed. This is the
   * 50-point of the reporting scale: `sum` landing here means the answers
   * carried no information about the trait either way.
   */
  chanceSum?: number;
  /** Sum of the most this trait could have been expressed — the 100-point. */
  bestSum?: number;
  /** Sum of the least it could have been — the 0-point. */
  worstSum?: number;
}

/**
 * What one question made possible for one trait, over every answer a candidate
 * could have given it.
 *
 * `chance` is the mean of those outcomes rather than the midpoint of
 * `worst..best`, and the two are rarely the same number: a question offering
 * +3/+2/0/-3 on a trait has a midpoint of 0 but a chance value of +0.5. Only
 * the mean is what a random answer actually earns, so only the mean can anchor
 * the middle of the scale.
 */
export interface TraitRange {
  chance: number;
  best: number;
  worst: number;
}

/**
 * What one answer to a probe question amounted to — enough to compare against
 * its twin, and no more.
 *
 * Objective twins compare on the outcome: answering one right and the other
 * wrong means the right answer was not knowledge. Trait twins compare on the
 * weights, because there is no right answer to compare on.
 */
export type ProbeSignature =
  | { kind: 'objective'; isCorrect: boolean }
  | { kind: 'trait'; weights: Record<string, number> }
  /** The clock ran out with the question on screen — nothing to compare. */
  | { kind: 'unanswered' };

/** One trait the twins disagreed on, with both weights. */
export interface ProbeDivergence {
  key: string;
  first: number;
  second: number;
}

/**
 * One repeat probe: a question, and the reworded twin served well after it.
 *
 * Lives on the module state while the module runs and is persisted to
 * `session_module_results.probeResults` when it closes, so the recruiter's
 * report can put the two answers side by side.
 */
export interface ProbePair {
  /** The `probeGroup` both questions share. */
  group: string;

  firstQuestionId: string;
  /** Sequence number within the session, for the report's detail view. */
  firstSequence: number;
  first: ProbeSignature;
  /** `answered` in this module when the first twin was answered. */
  askedAtAnswered: number;

  /** All null until the twin is answered. */
  secondQuestionId: string | null;
  secondSequence: number | null;
  second: ProbeSignature | null;

  /**
   * How closely the two answers agreed, 0..1. Null while the pair is open, and
   * also when the pair closed on something uncomparable — a twin that timed out
   * unanswered, or one whose weights share no trait with the first.
   */
  agreement: number | null;
  /** Objective only: the right/wrong outcome changed between the twins. */
  flipped: boolean | null;
  /** Trait only: the traits that disagreed most, worst first. */
  divergentTraits: ProbeDivergence[];
}

/**
 * A module's probe outcome, as stored on `session_module_results` and read back
 * by the report.
 */
export interface ProbeResults {
  pairs: ProbePair[];
  /** Mean agreement across the pairs that closed comparably, or null. */
  agreement: number | null;
  /** Pairs that closed and could be compared. */
  resolved: number;
  /** Pairs whose twin never came round before the module ended. */
  unresolved: number;
}

/** What the evaluation service produces for one submitted answer. */
export interface EvaluationResult {
  /** Null for trait modules — there is no right answer there. */
  isCorrect: boolean | null;
  /** trait key -> weight contributed. Empty for objective modules. */
  traitWeights: Record<string, number>;
}
