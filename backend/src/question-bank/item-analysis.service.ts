import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QuestionStatus } from '../common/enums';
import { Question } from './entities/question.entity';
import { QUESTION_VISIBLE_TO_ORG_POSITIONAL } from './question-visibility';

/**
 * How many scored attempts a question needs before any of this is published.
 *
 * Every figure below is a proportion or a correlation, and both are worthless
 * on a handful of observations — a discrimination of -0.4 from six attempts is
 * noise, and flagging it would send a recruiter to retire a perfectly good
 * question.
 */
export const MIN_ATTEMPTS = 20;

/** Answered correctly this often or more: it separates nobody. */
const TOO_EASY_ABOVE = 0.95;
/** Answered correctly this rarely: either broken or mis-keyed. */
const TOO_HARD_BELOW = 0.2;
/** Below this, strong candidates are not outperforming weak ones. */
const WEAK_DISCRIMINATION_BELOW = 0.1;
/** A wrong option picked this rarely is not doing any work. */
const DEAD_DISTRACTOR_BELOW = 0.02;
/** Elo points of disagreement between authored and observed difficulty. */
const DRIFT_TOLERANCE = 250;

export type ItemFlag =
  /** Not enough scored attempts yet for any of the statistics to mean anything. */
  | 'insufficient_data'
  | 'too_easy'
  | 'too_hard'
  /** Strong and weak candidates do about equally well — it measures nothing. */
  | 'weak_discrimination'
  /**
   * Weak candidates do *better* than strong ones. Nearly always a mis-keyed
   * correct answer, and the single most damaging thing a bank can contain: it
   * actively scores good candidates down.
   */
  | 'negative_discrimination'
  /** At least one wrong option is never chosen, so the item is easier than it looks. */
  | 'dead_distractor'
  /** Observed difficulty has drifted a long way from what was authored. */
  | 'difficulty_drift';

export interface ItemOptionStat {
  key: string;
  text: string;
  isCorrect: boolean;
  /** Share of attempts that chose this option, 0-1. */
  pickRate: number;
}

export interface ItemAnalysis {
  questionId: string;
  questionText: string;
  moduleName: string;
  status: QuestionStatus;
  /** The Elo-scale difficulty the question was authored with. */
  authoredDifficulty: number;
  /** Scored attempts behind these figures. */
  attempts: number;
  /** Proportion answered correctly — difficulty as observed, 0-1. */
  pValue: number | null;
  /**
   * Point-biserial correlation between getting this question right and overall
   * ability on that attempt, -1 to 1.
   *
   * The single most useful number here: it answers "does this question actually
   * tell strong candidates from weak ones", which `timesCorrect` alone cannot.
   */
  discrimination: number | null;
  /**
   * Difficulty implied by how candidates actually performed, minus the authored
   * one. Positive means the question is harder in practice than it claims.
   */
  drift: number | null;
  options: ItemOptionStat[];
  flags: ItemFlag[];
}

interface StatRow {
  questionId: string;
  attempts: string;
  pValue: string | null;
  meanAbility: string | null;
  discrimination: string | null;
}

interface PickRow {
  questionId: string;
  selectedOption: string;
  picks: string;
}

interface QuestionRow {
  id: string;
  questionText: string;
  status: QuestionStatus;
  moduleName: string;
  difficultyScore: number;
  options: { key: string; text: string }[];
  correctOption: string;
}

/**
 * Classical item analysis over the answers already stored.
 *
 * `times_used` and `times_correct` have been tracked on every MCQ since the
 * beginning and surfaced nowhere, which meant a question that scored good
 * candidates *down* looked exactly like one that worked. Everything here is
 * derived from `responses` joined to the ability estimate for the attempt it
 * belonged to — no new data collection, and nothing a recruiter has to do.
 */
@Injectable()
export class ItemAnalysisService {
  constructor(
    @InjectRepository(Question)
    private readonly questions: Repository<Question>,
  ) {}

  async forOrganisation(
    organisationId: string,
    options: { moduleId?: string; limit?: number } = {},
  ): Promise<ItemAnalysis[]> {
    const limit = Math.min(options.limit ?? 200, 500);

    // The questions this organisation may see — its own, plus the platform ones
    // it has not forked. Same rule as the bank listing and the engine's
    // selector, imported rather than restated.
    const questions = await this.questions.manager.query<QuestionRow[]>(
      `
      SELECT q.id,
             q."questionText",
             q.status,
             m.name                AS "moduleName",
             d."difficultyScore",
             d.options,
             d."correctOption"
        FROM questions q
        JOIN mcq_question_details d ON d."questionId" = q.id
        JOIN modules m ON m.id = q."moduleId"
       WHERE ${QUESTION_VISIBLE_TO_ORG_POSITIONAL}
         AND ($2::uuid IS NULL OR q."moduleId" = $2)
       ORDER BY q."createdAt" DESC
       LIMIT $3
      `,
      [organisationId, options.moduleId ?? null, limit],
    );

    if (questions.length === 0) return [];

    const ids = questions.map((q) => q.id);

    /*
     * `corr(correct, ability)` *is* the point-biserial coefficient: point-
     * biserial is Pearson's r with one dichotomous variable, so Postgres
     * computes it directly and there is no hand-rolled statistics to get wrong.
     *
     * Only submitted attempts count, and only where the module produced an
     * ability estimate — correlating against a half-finished estimate would
     * measure the engine's warm-up rather than the question.
     */
    const stats = await this.questions.manager.query<StatRow[]>(
      `
      WITH answered AS (
        SELECT r."questionId",
               (CASE WHEN r."isCorrect" THEN 1 ELSE 0 END)::float8 AS correct,
               smr."abilityScore"::float8                          AS ability
          FROM responses r
          JOIN assessment_sessions s ON s.id = r."sessionId"
          JOIN session_module_results smr
            ON smr."sessionId" = r."sessionId"
           AND smr."moduleId"  = r."moduleId"
         WHERE r."questionId" = ANY($1::uuid[])
           AND s."submittedAt" IS NOT NULL
           AND r."isCorrect" IS NOT NULL
           AND smr."abilityScore" IS NOT NULL
      )
      SELECT "questionId",
             count(*)                AS attempts,
             avg(correct)            AS "pValue",
             avg(ability)            AS "meanAbility",
             corr(correct, ability)  AS discrimination
        FROM answered
       GROUP BY "questionId"
      `,
      [ids],
    );

    // Distractor analysis is a separate pass because it counts every answer,
    // including ones on attempts that were never scored — how often an option
    // is chosen does not depend on the ability estimate.
    const picks = await this.questions.manager.query<PickRow[]>(
      `
      SELECT r."questionId", r."selectedOption", count(*) AS picks
        FROM responses r
        JOIN assessment_sessions s ON s.id = r."sessionId"
       WHERE r."questionId" = ANY($1::uuid[])
         AND s."submittedAt" IS NOT NULL
         AND r."selectedOption" IS NOT NULL
       GROUP BY r."questionId", r."selectedOption"
      `,
      [ids],
    );

    const statByQuestion = new Map(stats.map((row) => [row.questionId, row]));
    const picksByQuestion = new Map<string, Map<string, number>>();
    for (const row of picks) {
      const forQuestion =
        picksByQuestion.get(row.questionId) ?? new Map<string, number>();
      forQuestion.set(row.selectedOption, Number(row.picks));
      picksByQuestion.set(row.questionId, forQuestion);
    }

    return questions.map((question) =>
      this.assemble(
        question,
        statByQuestion.get(question.id),
        picksByQuestion.get(question.id) ?? new Map<string, number>(),
      ),
    );
  }

  private assemble(
    question: QuestionRow,
    stat: StatRow | undefined,
    picks: Map<string, number>,
  ): ItemAnalysis {
    const attempts = Number(stat?.attempts ?? 0);
    const enough = attempts >= MIN_ATTEMPTS;

    const pValue =
      enough && stat?.pValue !== null ? Number(stat?.pValue) : null;
    // `corr` returns null for a constant column — everyone right or everyone
    // wrong. That is genuinely "no discrimination measurable", not zero.
    const discrimination =
      enough &&
      stat?.discrimination !== null &&
      stat?.discrimination !== undefined
        ? Number(stat.discrimination)
        : null;

    const totalPicks = [...picks.values()].reduce((sum, n) => sum + n, 0);
    const options: ItemOptionStat[] = question.options.map((option) => ({
      key: option.key,
      text: option.text,
      isCorrect: option.key === question.correctOption,
      pickRate: totalPicks > 0 ? (picks.get(option.key) ?? 0) / totalPicks : 0,
    }));

    const drift =
      enough && pValue !== null && stat?.meanAbility != null
        ? this.impliedDifficulty(pValue, Number(stat.meanAbility)) -
          question.difficultyScore
        : null;

    return {
      questionId: question.id,
      questionText: question.questionText,
      moduleName: question.moduleName,
      status: question.status,
      authoredDifficulty: question.difficultyScore,
      attempts,
      pValue,
      discrimination,
      drift,
      options,
      flags: this.flag({ enough, pValue, discrimination, drift, options }),
    };
  }

  /**
   * The difficulty that would produce this pass rate, per the engine's own Elo
   * model — the inverse of the expected-score formula the estimator uses.
   *
   * Deriving it the same way the engine scores means "drift" is a disagreement
   * within one model, not a comparison between two different scales.
   */
  private impliedDifficulty(pValue: number, meanAbility: number): number {
    // Clamped away from the asymptotes: at p of exactly 0 or 1 the implied
    // difficulty is infinite, which is not a useful thing to show anybody.
    const p = Math.min(0.99, Math.max(0.01, pValue));
    return meanAbility + 400 * Math.log10((1 - p) / p);
  }

  private flag(input: {
    enough: boolean;
    pValue: number | null;
    discrimination: number | null;
    drift: number | null;
    options: ItemOptionStat[];
  }): ItemFlag[] {
    if (!input.enough) return ['insufficient_data'];

    const flags: ItemFlag[] = [];
    const { pValue, discrimination, drift, options } = input;

    if (pValue !== null && pValue > TOO_EASY_ABOVE) flags.push('too_easy');
    if (pValue !== null && pValue < TOO_HARD_BELOW) flags.push('too_hard');

    if (discrimination !== null) {
      // Order matters: a negative coefficient is a different and much worse
      // problem than a weak one, and should not be reported as merely weak.
      if (discrimination < 0) flags.push('negative_discrimination');
      else if (discrimination < WEAK_DISCRIMINATION_BELOW) {
        flags.push('weak_discrimination');
      }
    }

    const deadDistractor = options.some(
      (option) => !option.isCorrect && option.pickRate < DEAD_DISTRACTOR_BELOW,
    );
    if (deadDistractor) flags.push('dead_distractor');

    if (drift !== null && Math.abs(drift) > DRIFT_TOLERANCE) {
      flags.push('difficulty_drift');
    }

    return flags;
  }
}
