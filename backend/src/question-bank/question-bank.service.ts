import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import {
  TRAIT_WEIGHT_MAX,
  TRAIT_WEIGHT_MIN,
} from '../adaptive-engine/adaptive-engine.constants';
import {
  BehavioralPattern,
  QuestionStatus,
  ScoringType,
} from '../common/enums';
import { ModuleCatalogEntry } from '../modules-catalog/entities/module.entity';
import {
  LEGACY_OPTION_BOUNDS,
  PATTERN_OPTION_BOUNDS,
} from './question-bank.constants';
import { CreateQuestionDto } from './dto/create-question.dto';
import { QueryQuestionsDto } from './dto/query-questions.dto';
import {
  McqDetailsDto,
  PersonalityDetailsDto,
} from './dto/question-details.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import {
  DEFAULT_DIFFICULTY_SCORE,
  McqQuestionDetails,
} from './entities/mcq-question-details.entity';
import { PersonalityQuestionDetails } from './entities/personality-question-details.entity';
import { Question } from './entities/question.entity';
import {
  QUESTION_VISIBLE_TO_ORG,
  QUESTION_VISIBLE_TO_ORG_POSITIONAL,
} from './question-visibility';

export interface PaginatedQuestions {
  items: Question[];
  total: number;
  page: number;
  limit: number;
}

export interface ModuleQuestionStats {
  moduleId: string;
  name: string;
  slug: string;
  scoringType: ScoringType;
  total: number;
  active: number;
  draft: number;
  archived: number;
}

@Injectable()
export class QuestionBankService {
  constructor(
    @InjectRepository(Question)
    private readonly questions: Repository<Question>,
    @InjectRepository(ModuleCatalogEntry)
    private readonly modules: Repository<ModuleCatalogEntry>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * A probe group may only span questions inside one module.
   *
   * The engine serves a twin during a single module's run, holding it back until
   * the gap has passed. A group whose other half sits in a different module can
   * therefore never be closed: the pair would open, spend a question, and be
   * reported as unresolved for every candidate. Rejecting it at authoring time is
   * the only place the mistake is cheap to fix.
   *
   * The check looks only at this organisation's own questions. Group names are
   * per-organisation, so two companies may both use "pg-teamwork" without one
   * blocking the other — and, more importantly, without the error message
   * revealing that another customer uses that name at all.
   */
  private async assertProbeGroupFitsModule(
    probeGroup: string | undefined,
    moduleId: string,
    organisationId: string | null,
    excludeQuestionId?: string,
  ): Promise<void> {
    if (!probeGroup) return;

    const siblings = await this.questions.find({
      // Platform groups are checked against platform questions and an
      // organisation's against its own, so the two namespaces stay separate.
      where: {
        probeGroup,
        organisationId: organisationId === null ? IsNull() : organisationId,
      },
      select: { id: true, moduleId: true },
    });

    const foreign = siblings.find(
      (sibling) =>
        sibling.id !== excludeQuestionId && sibling.moduleId !== moduleId,
    );
    if (foreign) {
      throw new BadRequestException(
        `Probe group "${probeGroup}" is already used by a question in another ` +
          'module. Both halves of a pair must be in the same module, because ' +
          'the engine only serves a twin within one module’s run.',
      );
    }
  }

  /**
   * `organisationId` null creates a *platform* question — shared with every
   * organisation and editable by none. Only the seed script does that; every
   * request path passes a real organisation via `@CurrentOrg()`, which cannot
   * be null.
   */
  async create(
    dto: CreateQuestionDto,
    organisationId: string | null,
    createdById: string,
  ): Promise<Question> {
    const module = await this.modules.findOne({ where: { id: dto.moduleId } });
    if (!module)
      throw new NotFoundException(`Module ${dto.moduleId} not found`);

    // A new behavioural question must declare its pattern; there is no stored
    // value to fall back on, and defaulting one would mislabel the question.
    this.assertPayloadMatchesModule(module, dto.mcq, dto.personality, {
      requirePattern: true,
    });
    await this.assertProbeGroupFitsModule(
      dto.probeGroup,
      module.id,
      organisationId,
    );

    // Parent and child must land together — a questions row with no detail row
    // would be silently unusable by the selector.
    return this.dataSource.transaction(async (manager) => {
      const question = await manager.save(
        manager.create(Question, {
          moduleId: module.id,
          questionText: dto.questionText,
          status: dto.status ?? QuestionStatus.DRAFT,
          tags: dto.tags ?? [],
          // `||` not `??`: the form always sends this field, and an empty
          // string must mean "not twinned" rather than becoming a group name
          // that every untwinned question would then share.
          probeGroup: dto.probeGroup || null,
          isSample: dto.isSample ?? false,
          // Authored questions always belong to their organisation. Only the
          // seed script creates platform questions, by leaving this null.
          organisationId,
          createdById,
        }),
      );

      if (dto.mcq) {
        await manager.save(
          manager.create(McqQuestionDetails, {
            questionId: question.id,
            options: dto.mcq.options,
            correctOption: dto.mcq.correctOption,
            difficultyScore:
              dto.mcq.difficultyScore ?? DEFAULT_DIFFICULTY_SCORE,
          }),
        );
      } else {
        await manager.save(
          manager.create(PersonalityQuestionDetails, {
            questionId: question.id,
            options: dto.personality!.options,
            pattern: dto.personality!.pattern ?? null,
          }),
        );
      }

      return manager.findOneOrFail(Question, {
        where: { id: question.id },
        relations: { mcqDetails: true, personalityDetails: true },
      });
    });
  }

  async findAll(
    query: QueryQuestionsDto,
    organisationId: string,
  ): Promise<PaginatedQuestions> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;

    const qb = this.questions
      .createQueryBuilder('q')
      .leftJoinAndSelect('q.mcqDetails', 'mcq')
      .leftJoinAndSelect('q.personalityDetails', 'personality')
      .leftJoinAndSelect('q.module', 'module')
      // The starter bank the platform ships, plus this organisation's own
      // questions. Never another organisation's.
      .where(QUESTION_VISIBLE_TO_ORG, { organisationId })
      .orderBy('q.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (query.moduleId) {
      qb.andWhere('q.moduleId = :moduleId', { moduleId: query.moduleId });
    }
    if (query.status) {
      qb.andWhere('q.status = :status', { status: query.status });
    }
    if (query.tags?.length) {
      // @> is "array contains all of" — every listed tag must be present.
      qb.andWhere('q.tags @> :tags', { tags: query.tags });
    }
    if (query.search) {
      qb.andWhere('q.questionText ILIKE :search', {
        search: `%${query.search}%`,
      });
    }
    if (query.minDifficulty !== undefined) {
      qb.andWhere('mcq.difficultyScore >= :min', { min: query.minDifficulty });
    }
    if (query.maxDifficulty !== undefined) {
      qb.andWhere('mcq.difficultyScore <= :max', { max: query.maxDifficulty });
    }

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, limit };
  }

  /**
   * Per-module counts in one round trip.
   *
   * The dashboard used to derive these client-side by issuing a count query
   * per module per status — 13 requests to render four numbers, which tripped
   * the rate limiter. One GROUP BY replaces all of them.
   */
  async moduleStats(organisationId: string): Promise<ModuleQuestionStats[]> {
    return this.dataSource.query<ModuleQuestionStats[]>(
      `
      SELECT m.id                                                    AS "moduleId",
             m.name                                                  AS name,
             m.slug                                                  AS slug,
             m."scoringType"                                         AS "scoringType",
             count(q.id)::int                                        AS total,
             count(q.id) FILTER (WHERE q.status = 'active')::int     AS active,
             count(q.id) FILTER (WHERE q.status = 'draft')::int      AS draft,
             count(q.id) FILTER (WHERE q.status = 'archived')::int   AS archived
      FROM modules m
      LEFT JOIN questions q
        ON q."moduleId" = m.id
       AND ${QUESTION_VISIBLE_TO_ORG_POSITIONAL}
      GROUP BY m.id, m.name, m.slug, m."scoringType"
      ORDER BY m.name
    `,
      [organisationId],
    );
  }

  /**
   * One question this organisation is allowed to see: its own, or a platform
   * question. Same 404 either way for anything else, so the API cannot be used
   * to confirm another company's question exists.
   */
  async findOne(id: string, organisationId: string): Promise<Question> {
    const question = await this.questions
      .createQueryBuilder('q')
      .leftJoinAndSelect('q.mcqDetails', 'mcqDetails')
      .leftJoinAndSelect('q.personalityDetails', 'personalityDetails')
      .leftJoinAndSelect('q.module', 'module')
      .where('q.id = :id', { id })
      .andWhere(QUESTION_VISIBLE_TO_ORG, { organisationId })
      .getOne();

    if (!question) throw new NotFoundException(`Question ${id} not found`);
    return question;
  }

  /**
   * A private copy of a platform question, carrying the requested changes.
   *
   * Platform questions are shared, so an organisation may not edit one in place:
   * rewording or archiving content another customer's live assessment depends on
   * is exactly what tenancy exists to prevent. Refusing outright would leave a
   * recruiter stuck with starter content they do not want, so the edit is taken
   * on a fork instead. From then on this organisation sees its own version and
   * every other organisation still sees the original — the visibility rule hides
   * a platform question from whoever has forked it.
   *
   * Counters start at zero because exposure and correctness are facts about a
   * specific question being served, and this is a new one. The difficulty score
   * is copied rather than reset: the platform value is the best starting estimate
   * anyone has, and from here it calibrates against this organisation's own
   * candidates.
   */
  private async forkPlatformQuestion(
    original: Question,
    dto: UpdateQuestionDto,
    organisationId: string,
    createdById: string,
  ): Promise<Question> {
    return this.dataSource.transaction(async (manager) => {
      const fork = await manager.save(
        manager.create(Question, {
          moduleId: original.moduleId,
          questionText: dto.questionText ?? original.questionText,
          status: dto.status ?? original.status,
          tags: dto.tags ?? original.tags,
          probeGroup:
            dto.probeGroup === undefined
              ? original.probeGroup
              : dto.probeGroup || null,
          isSample: dto.isSample ?? original.isSample,
          organisationId,
          createdById,
          forkedFromId: original.id,
        }),
      );

      if (original.mcqDetails) {
        const source = original.mcqDetails;
        await manager.save(
          manager.create(McqQuestionDetails, {
            questionId: fork.id,
            options: dto.mcq?.options ?? source.options,
            correctOption: dto.mcq?.correctOption ?? source.correctOption,
            difficultyScore: dto.mcq?.difficultyScore ?? source.difficultyScore,
          }),
        );
      } else if (original.personalityDetails) {
        const source = original.personalityDetails;
        await manager.save(
          manager.create(PersonalityQuestionDetails, {
            questionId: fork.id,
            options: dto.personality?.options ?? source.options,
            pattern: dto.personality?.pattern ?? source.pattern,
          }),
        );
      }

      return manager.findOneOrFail(Question, {
        where: { id: fork.id },
        relations: { mcqDetails: true, personalityDetails: true, module: true },
      });
    });
  }

  /**
   * Applies an edit, taking a private copy first if the target is a platform
   * question. The returned question may therefore have a different id from the
   * one asked for — it is this organisation's version of it.
   */
  async update(
    id: string,
    dto: UpdateQuestionDto,
    organisationId: string,
    createdById: string,
  ): Promise<Question> {
    const target = await this.findOne(id, organisationId);

    if (target.organisationId === null) {
      // No need to look for an existing fork: once this organisation has one,
      // the visibility rule hides the platform original from them, so `findOne`
      // above would already have thrown. Reaching here means the first edit.
      if (dto.mcq || dto.personality) {
        this.assertPayloadMatchesModule(
          target.module,
          dto.mcq,
          dto.personality,
          {
            existingPattern: target.personalityDetails?.pattern ?? null,
          },
        );
      }
      await this.assertProbeGroupFitsModule(
        dto.probeGroup,
        target.moduleId,
        organisationId,
      );
      return this.forkPlatformQuestion(
        target,
        dto,
        organisationId,
        createdById,
      );
    }

    const question = target;
    const module = question.module;

    if (dto.mcq || dto.personality) {
      this.assertPayloadMatchesModule(module, dto.mcq, dto.personality, {
        existingPattern: question.personalityDetails?.pattern ?? null,
      });
    }
    await this.assertProbeGroupFitsModule(
      dto.probeGroup,
      module.id,
      organisationId,
      id,
    );

    await this.dataSource.transaction(async (manager) => {
      if (dto.questionText !== undefined)
        question.questionText = dto.questionText;
      if (dto.status !== undefined) question.status = dto.status;
      if (dto.tags !== undefined) question.tags = dto.tags;
      // An empty string clears the pairing, which is how a question gets
      // untwinned without deleting and re-authoring it.
      if (dto.probeGroup !== undefined)
        question.probeGroup = dto.probeGroup || null;
      // Flipping this on takes the question out of circulation for real
      // attempts, and flipping it off puts it back — both are deliberate acts,
      // so neither is inferred from anything else.
      if (dto.isSample !== undefined) question.isSample = dto.isSample;
      await manager.save(question);

      if (dto.mcq) {
        await manager.update(
          McqQuestionDetails,
          { questionId: id },
          {
            options: dto.mcq.options,
            correctOption: dto.mcq.correctOption,
            ...(dto.mcq.difficultyScore !== undefined && {
              difficultyScore: dto.mcq.difficultyScore,
            }),
          },
        );
      }
      if (dto.personality) {
        await manager.update(
          PersonalityQuestionDetails,
          { questionId: id },
          {
            options: dto.personality.options,
            // Omitting the pattern leaves the stored one alone, so correcting
            // a legacy question's wording can't silently relabel it.
            ...(dto.personality.pattern !== undefined && {
              pattern: dto.personality.pattern,
            }),
          },
        );
      }
    });

    return this.findOne(id, organisationId);
  }

  /**
   * Soft-remove: flip to `archived` so the selector stops serving the question
   * while its history stays intact. This is always safe, even for a question
   * candidates have already answered — nothing is destroyed.
   *
   * On a platform question this is how an organisation hides one from itself: it
   * takes an archived fork, so the question leaves *their* bank and is never
   * served to *their* candidates, while every other organisation keeps it.
   */
  async archive(
    id: string,
    organisationId: string,
    createdById: string,
  ): Promise<Question> {
    return this.setStatus(
      id,
      QuestionStatus.ARCHIVED,
      organisationId,
      createdById,
    );
  }

  /**
   * Permanent delete. Only allowed for a question no candidate has ever
   * answered — `responses` references questions with ON DELETE RESTRICT, and
   * deleting one that has been served would erase result history the report
   * layer still reads back. When that is the case we refuse with a 409 and
   * point the caller at archiving instead.
   *
   * The two 1:1 detail rows (mcq / personality) cascade automatically, so a
   * clean delete needs no extra bookkeeping here.
   */
  async remove(
    id: string,
    organisationId: string,
  ): Promise<{ id: string; deleted: true }> {
    const question = await this.findOne(id, organisationId);

    // A platform question is not this organisation's to destroy — deleting it
    // would take it from every other customer too. Hiding is the scoped
    // equivalent, and unlike a delete it can be undone.
    if (question.organisationId === null) {
      throw new ForbiddenException(
        'This question belongs to the platform bank and is shared with every ' +
          'organisation, so it cannot be deleted. Hide it instead — that removes ' +
          'it from your bank and your assessments without affecting anyone else.',
      );
    }

    const responseCount = await this.countResponses(id);
    if (responseCount > 0) {
      throw new ConflictException(
        `This question has been answered in ${responseCount} ` +
          `assessment${responseCount === 1 ? '' : 's'} and can't be deleted ` +
          `without destroying those results. Archive it instead.`,
      );
    }

    await this.questions.delete({ id: question.id });
    return { id: question.id, deleted: true };
  }

  /** How many stored responses point at this question. */
  private async countResponses(questionId: string): Promise<number> {
    const rows = await this.dataSource.query<{ count: number }[]>(
      'SELECT count(*)::int AS count FROM responses WHERE "questionId" = $1',
      [questionId],
    );
    return rows[0]?.count ?? 0;
  }

  /**
   * Flips a question's status, forking first when it is a platform question so
   * the change only ever applies to this organisation.
   */
  async setStatus(
    id: string,
    status: QuestionStatus,
    organisationId: string,
    createdById: string,
  ): Promise<Question> {
    const target = await this.findOne(id, organisationId);

    if (target.organisationId === null) {
      // As in `update`: a visible platform question is one this organisation has
      // not forked yet, so this is always the first fork.
      return this.forkPlatformQuestion(
        target,
        { status },
        organisationId,
        createdById,
      );
    }

    target.status = status;
    return this.questions.save(target);
  }

  /**
   * Every rule that needs both the payload and its module. Shared by the
   * single-question endpoints and the bulk importer so the two can't drift.
   *
   * `context` carries what only the caller knows about a behavioural question:
   * whether a pattern must be supplied (it must, when creating) and what the
   * stored pattern is (so an update that omits it is still validated against
   * the right option-count rule).
   */
  assertPayloadMatchesModule(
    module: ModuleCatalogEntry,
    mcq: McqDetailsDto | undefined,
    personality: PersonalityDetailsDto | undefined,
    context: {
      requirePattern?: boolean;
      existingPattern?: BehavioralPattern | null;
    } = {},
  ): void {
    if (!mcq && !personality) {
      throw new BadRequestException(
        'Supply either an "mcq" or a "personality" block',
      );
    }
    if (mcq && personality) {
      throw new BadRequestException(
        'Supply only one of "mcq" or "personality", not both',
      );
    }

    if (module.scoringType === ScoringType.OBJECTIVE) {
      if (!mcq) {
        throw new BadRequestException(
          `Module "${module.slug}" is objective and needs an "mcq" block`,
        );
      }
      this.assertValidMcq(mcq);
      return;
    }

    if (!personality) {
      throw new BadRequestException(
        `Module "${module.slug}" is trait-scored and needs a "personality" block`,
      );
    }
    this.assertValidPersonality(module, personality, context);
  }

  private assertValidMcq(mcq: McqDetailsDto): void {
    const keys = mcq.options.map((o) => o.key);
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException('Option keys must be unique');
    }
    if (!keys.includes(mcq.correctOption)) {
      throw new BadRequestException(
        `correctOption "${mcq.correctOption}" is not one of the option keys (${keys.join(', ')})`,
      );
    }
  }

  private assertValidPersonality(
    module: ModuleCatalogEntry,
    personality: PersonalityDetailsDto,
    context: {
      requirePattern?: boolean;
      existingPattern?: BehavioralPattern | null;
    },
  ): void {
    const keys = personality.options.map((o) => o.key);
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException('Option keys must be unique');
    }

    // An update that omits the pattern keeps the stored one; a create has
    // nothing to fall back on, which is what `requirePattern` catches.
    const pattern = personality.pattern ?? context.existingPattern ?? null;
    if (context.requirePattern && !pattern) {
      throw new BadRequestException(
        'Choose a question pattern: ' +
          Object.values(BehavioralPattern).join(', '),
      );
    }
    this.assertOptionCount(personality, pattern);

    const declared = new Set((module.traits ?? []).map((t) => t.key));
    for (const option of personality.options) {
      const weights = Object.entries(option.traitWeights);
      if (weights.length === 0) {
        throw new BadRequestException(
          `Option "${option.key}" must weight at least one trait`,
        );
      }
      for (const [trait, weight] of weights) {
        if (!declared.has(trait)) {
          throw new BadRequestException(
            `Option "${option.key}" weights unknown trait "${trait}". ` +
              `Module "${module.slug}" declares: ${[...declared].join(', ')}`,
          );
        }
        if (typeof weight !== 'number' || !Number.isFinite(weight)) {
          throw new BadRequestException(
            `Weight for trait "${trait}" on option "${option.key}" must be a finite number`,
          );
        }
        // Out-of-range weights are clamped at scoring time, so without this
        // an author would get a silently wrong score rather than an error.
        if (weight < TRAIT_WEIGHT_MIN || weight > TRAIT_WEIGHT_MAX) {
          throw new BadRequestException(
            `Weight ${weight} for trait "${trait}" on option "${option.key}" ` +
              `is outside the ${TRAIT_WEIGHT_MIN}..+${TRAIT_WEIGHT_MAX} scale`,
          );
        }
      }
    }
  }

  /**
   * Each pattern has its own option count. Forced-choice and trade-off pit
   * exactly two alternatives against each other; ranking and situational need
   * at least three to carry any information.
   */
  private assertOptionCount(
    personality: PersonalityDetailsDto,
    pattern: BehavioralPattern | null,
  ): void {
    const bounds = pattern
      ? PATTERN_OPTION_BOUNDS[pattern]
      : LEGACY_OPTION_BOUNDS;
    const count = personality.options.length;
    if (count >= bounds.min && count <= bounds.max) return;

    const label = pattern ?? 'legacy';
    const expected =
      bounds.min === bounds.max
        ? `exactly ${bounds.min}`
        : `${bounds.min}-${bounds.max}`;
    throw new BadRequestException(
      `A "${label}" question takes ${expected} options, but ${count} were supplied`,
    );
  }
}
