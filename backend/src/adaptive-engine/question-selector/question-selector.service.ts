import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BehavioralPattern,
  QuestionStatus,
  ScoringType,
} from '../../common/enums';
import { McqQuestionDetails } from '../../question-bank/entities/mcq-question-details.entity';
import { Question } from '../../question-bank/entities/question.entity';
import {
  LEGACY_SELECTION_RATE,
  SELECTOR_SHORTLIST_SIZE,
} from '../adaptive-engine.constants';
import { AbilityEstimatorService } from '../ability-estimator/ability-estimator.service';
import { ConsistencyProbeService } from '../consistency-probe/consistency-probe.service';
import { QUESTION_VISIBLE_TO_ORG } from '../../question-bank/question-visibility';
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
    private readonly probes: ConsistencyProbeService,
  ) {}

  /**
   * Next question for a module, or null when its pool is exhausted.
   *
   * A repeat probe that has come due is served first, ahead of everything else:
   * an open pair has already spent a question, and only its twin can turn that
   * into a measurement.
   *
   * Otherwise —
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
      (await this.selectDueTwinId(state)) ??
      (await this.selectProbeOpenerId(state)) ??
      (await this.selectId(state));

    if (!id) return null;

    return await this.questions.findOne({
      where: { id },
      relations: { mcqDetails: true, personalityDetails: true },
    });
  }

  /** Ordinary selection, by whichever rule this module's scoring type uses. */
  private selectId(
    state: ModuleRunState,
    probeOnly = false,
  ): Promise<string | null> {
    return state.scoringType === ScoringType.OBJECTIVE
      ? this.selectObjectiveId(state, probeOnly)
      : this.selectTraitId(state, probeOnly);
  }

  /**
   * A question that would open a new probe pair, while there is still room in
   * the module for its twin to come back.
   *
   * Runs the module's ordinary selection rules restricted to probe-carrying
   * questions, rather than grabbing any probe question going: an objective
   * module still gets the closest difficulty match and a trait module still
   * targets its thinnest trait. The preference decides *which* of the questions
   * the selector was already happy with gets served, and nothing more.
   *
   * Falls through to ordinary selection when the bank has no probe question
   * that fits — the pairs are a bonus on top of the measurement, never a reason
   * to serve a worse-matched question.
   */
  private async selectProbeOpenerId(
    state: ModuleRunState,
  ): Promise<string | null> {
    if (!this.probes.wantsNewPair(state)) return null;
    return this.selectId(state, true);
  }

  /**
   * The reworded twin of an open probe, if one has come due and still exists.
   *
   * Returns null when the twin has been archived or deleted since the first half
   * was served. The pair then stays open and is reported as unresolved — an
   * honest "we could not check this" rather than a fabricated agreement.
   */
  private async selectDueTwinId(state: ModuleRunState): Promise<string | null> {
    const due = this.probes.dueTwin(state);
    if (!due) return null;

    return this.pickRandom(
      await this.baseQuery(state)
        .andWhere('q."probeGroup" = :group', { group: due.group })
        .limit(SELECTOR_SHORTLIST_SIZE)
        .getRawMany<{ id: string }>(),
    );
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
    probeOnly = false,
  ): Promise<string | null> {
    const query = this.baseQuery(state, probeOnly)
      .innerJoin(McqQuestionDetails, 'd', 'd."questionId" = q.id')
      // Closest difficulty first; among equally close ones prefer the item
      // that has been served least, which spreads exposure across the bank.
      .orderBy('ABS(d."difficultyScore" - :ability)', 'ASC')
      .addOrderBy('d."timesUsed"', 'ASC')
      .setParameter('ability', Math.round(state.ability))
      .limit(SELECTOR_SHORTLIST_SIZE);

    return this.pickRandom(await query.getRawMany<{ id: string }>());
  }

  /**
   * Trait modules pick on three axes, in priority order:
   *
   *   1. Behavioural vs legacy. Legacy Likert items are served at roughly
   *      `LEGACY_SELECTION_RATE` and never otherwise — they are bank depth,
   *      not the measurement.
   *   2. The trait we know least about, so coverage stays even however few
   *      questions the candidate ends up answering.
   *   3. Among those, the behavioural pattern used least so far, so a profile
   *      does not rest on one question shape.
   */
  private async selectTraitId(
    state: ModuleRunState,
    probeOnly = false,
  ): Promise<string | null> {
    // Legacy Likert items are never probe-authored, so a probe-only pass skips
    // straight to the behavioural bank instead of spending its turn on them.
    const legacyTurn = !probeOnly && Math.random() < LEGACY_SELECTION_RATE;

    if (legacyTurn) {
      const legacy = await this.pickLegacy(state);
      if (legacy) return legacy;
      // No legacy questions left; fall through to the behavioural bank rather
      // than ending the module early.
    }

    const trait = this.leastCoveredTrait(state);
    if (trait) {
      const picked = await this.pickBehavioral(state, trait, probeOnly);
      if (picked) return picked;
    }

    // Nothing covers that trait any more — take the least-served behavioural
    // question of the least-used pattern instead of ending the run.
    const anyBehavioral = await this.pickBehavioral(state, null, probeOnly);
    if (anyBehavioral) return anyBehavioral;

    // A probe-only pass stops here: there is no probe question left that fits,
    // and the caller falls back to ordinary selection.
    if (probeOnly) return null;

    // Behavioural bank exhausted. A legacy question is worse evidence than a
    // behavioural one but far better than stopping short of the minimum.
    return this.pickLegacy(state);
  }

  /**
   * Least-covered pattern first, so the shapes stay balanced. Ties keep
   * catalogue order, which makes the opening sequence stable rather than
   * dependent on object key ordering.
   */
  leastUsedPattern(state: ModuleRunState): BehavioralPattern {
    const patterns = Object.values(BehavioralPattern);
    let lowest = patterns[0];
    let lowestCount = Number.POSITIVE_INFINITY;

    for (const pattern of patterns) {
      const count = state.patternCounts[pattern] ?? 0;
      if (count < lowestCount) {
        lowest = pattern;
        lowestCount = count;
      }
    }

    return lowest;
  }

  /**
   * A behavioural question, optionally restricted to one trait. Tries the
   * least-used pattern first and widens to any pattern if that comes up empty,
   * so pattern balance never costs us trait coverage.
   */
  private async pickBehavioral(
    state: ModuleRunState,
    trait: string | null,
    probeOnly = false,
  ): Promise<string | null> {
    const preferred = this.leastUsedPattern(state);

    const targeted = await this.behavioralQuery(
      state,
      trait,
      preferred,
      probeOnly,
    )
      .getRawMany<{ id: string }>()
      .then((rows) => this.pickRandom(rows));
    if (targeted) return targeted;

    return this.pickRandom(
      await this.behavioralQuery(state, trait, null, probeOnly).getRawMany<{
        id: string;
      }>(),
    );
  }

  private behavioralQuery(
    state: ModuleRunState,
    trait: string | null,
    pattern: BehavioralPattern | null,
    probeOnly = false,
  ) {
    const query = this.baseQuery(state, probeOnly)
      .innerJoin('personality_question_details', 'p', 'p."questionId" = q.id')
      .andWhere('p.pattern IS NOT NULL');

    if (pattern) {
      query.andWhere('p.pattern = :pattern', { pattern });
    }
    if (trait) {
      query.andWhere(this.traitWeightExists(), { trait });
    }

    return query.orderBy('p."timesUsed"', 'ASC').limit(SELECTOR_SHORTLIST_SIZE);
  }

  /** A legacy agree/disagree question, still aimed at the thinnest trait. */
  private async pickLegacy(state: ModuleRunState): Promise<string | null> {
    const trait = this.leastCoveredTrait(state);

    const query = this.baseQuery(state)
      .innerJoin('personality_question_details', 'p', 'p."questionId" = q.id')
      .andWhere('p.pattern IS NULL');

    if (trait) {
      query.andWhere(this.traitWeightExists(), { trait });
    }

    const targeted = this.pickRandom(
      await query
        .orderBy('p."timesUsed"', 'ASC')
        .limit(SELECTOR_SHORTLIST_SIZE)
        .getRawMany<{ id: string }>(),
    );
    if (targeted) return targeted;

    return this.pickRandom(
      await this.baseQuery(state)
        .innerJoin('personality_question_details', 'p', 'p."questionId" = q.id')
        .andWhere('p.pattern IS NULL')
        .orderBy('p."timesUsed"', 'ASC')
        .limit(SELECTOR_SHORTLIST_SIZE)
        .getRawMany<{ id: string }>(),
    );
  }

  /**
   * jsonb_exists rather than the `?` operator: `?` collides with the driver's
   * parameter placeholders.
   */
  private traitWeightExists(): string {
    return `EXISTS (
       SELECT 1 FROM jsonb_array_elements(p.options) AS opt
       WHERE jsonb_exists(opt->'traitWeights', :trait)
     )`;
  }

  private baseQuery(state: ModuleRunState, probeOnly = false) {
    const query = this.questions
      .createQueryBuilder('q')
      .select('q.id', 'id')
      .where('q."moduleId" = :moduleId', { moduleId: state.moduleId })
      // Draft and archived questions never reach a candidate.
      .andWhere('q.status = :status', { status: QuestionStatus.ACTIVE })
      // The platform bank plus this organisation's own questions, and never
      // another organisation's. Without this the engine happily served one
      // customer's private questions inside another customer's assessment.
      //
      // Fork-aware, so a platform question this organisation has edited is
      // replaced by their version, and one they have hidden is not served at all.
      .andWhere(QUESTION_VISIBLE_TO_ORG, {
        organisationId: state.organisationId,
      });

    // A curated pool narrows what the engine may draw from; it does not replace
    // the choosing. Difficulty matching, trait targeting and the probe rules all
    // still apply — within the recruiter's approved set instead of the whole bank.
    if (state.poolRestricted) {
      query.andWhere(
        `EXISTS (
           SELECT 1 FROM assessment_questions pool
            WHERE pool."assessmentId" = :assessmentId
              AND pool."questionId" = q.id
         )`,
        { assessmentId: state.assessmentId },
      );
    }

    if (probeOnly) {
      query.andWhere('q."probeGroup" IS NOT NULL');
    }

    if (state.seenQuestionIds.length > 0) {
      query.andWhere('q.id NOT IN (:...seen)', {
        seen: state.seenQuestionIds,
      });
    }

    // Probe groups that are mid-gap or already closed are off the table. This is
    // what stops a twin from turning up two questions after its pair opened —
    // which a candidate would recognise, making the second answer a copy of the
    // first instead of independent evidence.
    //
    // The one due group is excluded from this list, so `selectDueTwinId` can
    // build on the same base query and still find it.
    const blocked = this.probes.blockedGroups(state);
    if (blocked.length > 0) {
      query.andWhere(
        '(q."probeGroup" IS NULL OR q."probeGroup" NOT IN (:...blocked))',
        { blocked },
      );
    }

    return query;
  }

  private pickRandom(rows: { id: string }[]): string | null {
    if (rows.length === 0) return null;
    return rows[Math.floor(Math.random() * rows.length)].id;
  }
}
