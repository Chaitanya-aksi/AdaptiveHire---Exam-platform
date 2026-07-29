import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QuestionStatus, ScoringType } from '../../common/enums';
import { McqQuestionDetails } from '../../question-bank/entities/mcq-question-details.entity';
import { Question } from '../../question-bank/entities/question.entity';
import { SELECTOR_SHORTLIST_SIZE } from '../adaptive-engine.constants';
import { AbilityEstimatorService } from '../ability-estimator/ability-estimator.service';
import type { ModuleRunState } from '../engine.types';

/**
 * A question ready to serve, with its scoring-type-specific payload already
 * loaded. `mcqDetails` is set for objective modules and
 * `personalityDetails` for trait modules — never both.
 */
export type SelectedQuestion = Question & {
  mcqDetails: McqQuestionDetails | null;
};

@Injectable()
export class QuestionSelectorService {
  constructor(
    @InjectRepository(Question)
    private readonly questions: Repository<Question>,
    private readonly estimator: AbilityEstimatorService,
  ) {}

  /**
   * Next question for a module, or null when its pool is exhausted.
   *
   * Objective: shortlist the questions closest to the candidate's current
   * ability, then pick one at random. Matching difficulty is what makes the
   * test adaptive; randomising within the shortlist is what stops two
   * candidates of similar ability from sitting an identical paper.
   *
   * Trait: pick for the trait we know least about, so coverage stays even
   * however few questions the candidate ends up answering.
   */
  async selectNext(state: ModuleRunState): Promise<SelectedQuestion | null> {
    const id =
      state.scoringType === ScoringType.OBJECTIVE
        ? await this.selectObjectiveId(state)
        : await this.selectTraitId(state);

    if (!id) return null;

    return await this.questions.findOne({
      where: { id },
      relations: { mcqDetails: true, personalityDetails: true },
    });
  }

  /** The trait with the least coverage so far — what the next question targets. */
  leastCoveredTrait(state: ModuleRunState): string | null {
    const keys = state.traits.length
      ? state.traits.map((trait) => trait.key)
      : Object.keys(state.traitTallies);
    if (keys.length === 0) return null;

    // Ties resolve to the first in catalogue order, which keeps the opening
    // sequence stable rather than dependent on object key ordering.
    let lowest = keys[0];
    let lowestConfidence = Number.POSITIVE_INFINITY;

    for (const key of keys) {
      const confidence = this.estimator.traitConfidence(
        state.traitTallies[key],
      );
      if (confidence < lowestConfidence) {
        lowest = key;
        lowestConfidence = confidence;
      }
    }

    return lowest;
  }

  private async selectObjectiveId(
    state: ModuleRunState,
  ): Promise<string | null> {
    const query = this.baseQuery(state)
      .innerJoin(McqQuestionDetails, 'd', 'd."questionId" = q.id')
      // Closest difficulty first; among equally close ones prefer the item
      // that has been served least, which spreads exposure across the bank.
      .orderBy('ABS(d."difficultyScore" - :ability)', 'ASC')
      .addOrderBy('d."timesUsed"', 'ASC')
      .setParameter('ability', Math.round(state.ability))
      .limit(SELECTOR_SHORTLIST_SIZE);

    return this.pickRandom(await query.getRawMany<{ id: string }>());
  }

  private async selectTraitId(state: ModuleRunState): Promise<string | null> {
    const trait = this.leastCoveredTrait(state);

    if (trait) {
      const targeted = await this.traitQuery(state, trait).getRawMany<{
        id: string;
      }>();
      const picked = this.pickRandom(targeted);
      if (picked) return picked;
    }

    // The bank has nothing left for that trait — take any unseen question in
    // the module rather than ending the candidate's run early.
    const fallback = await this.baseQuery(state)
      .innerJoin('personality_question_details', 'p', 'p."questionId" = q.id')
      .orderBy('p."timesUsed"', 'ASC')
      .limit(SELECTOR_SHORTLIST_SIZE)
      .getRawMany<{ id: string }>();

    return this.pickRandom(fallback);
  }

  private traitQuery(state: ModuleRunState, trait: string) {
    return this.baseQuery(state)
      .innerJoin('personality_question_details', 'p', 'p."questionId" = q.id')
      .andWhere(
        // jsonb_exists rather than the `?` operator: `?` collides with the
        // driver's parameter placeholders.
        `EXISTS (
           SELECT 1 FROM jsonb_array_elements(p.options) AS opt
           WHERE jsonb_exists(opt->'traitWeights', :trait)
         )`,
        { trait },
      )
      .orderBy('p."timesUsed"', 'ASC')
      .limit(SELECTOR_SHORTLIST_SIZE);
  }

  private baseQuery(state: ModuleRunState) {
    const query = this.questions
      .createQueryBuilder('q')
      .select('q.id', 'id')
      .where('q."moduleId" = :moduleId', { moduleId: state.moduleId })
      // Draft and archived questions never reach a candidate.
      .andWhere('q.status = :status', { status: QuestionStatus.ACTIVE });

    if (state.seenQuestionIds.length > 0) {
      query.andWhere('q.id NOT IN (:...seen)', {
        seen: state.seenQuestionIds,
      });
    }

    return query;
  }

  private pickRandom(rows: { id: string }[]): string | null {
    if (rows.length === 0) return null;
    return rows[Math.floor(Math.random() * rows.length)].id;
  }
}
