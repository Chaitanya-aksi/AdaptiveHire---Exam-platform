import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { QuestionStatus, ScoringType } from '../common/enums';
import { ModuleCatalogEntry } from '../modules-catalog/entities/module.entity';
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

  async create(dto: CreateQuestionDto, createdById: string): Promise<Question> {
    const module = await this.modules.findOne({ where: { id: dto.moduleId } });
    if (!module)
      throw new NotFoundException(`Module ${dto.moduleId} not found`);

    this.assertPayloadMatchesModule(module, dto.mcq, dto.personality);

    // Parent and child must land together — a questions row with no detail row
    // would be silently unusable by the selector.
    return this.dataSource.transaction(async (manager) => {
      const question = await manager.save(
        manager.create(Question, {
          moduleId: module.id,
          questionText: dto.questionText,
          status: dto.status ?? QuestionStatus.DRAFT,
          tags: dto.tags ?? [],
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
          }),
        );
      }

      return manager.findOneOrFail(Question, {
        where: { id: question.id },
        relations: { mcqDetails: true, personalityDetails: true },
      });
    });
  }

  async findAll(query: QueryQuestionsDto): Promise<PaginatedQuestions> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;

    const qb = this.questions
      .createQueryBuilder('q')
      .leftJoinAndSelect('q.mcqDetails', 'mcq')
      .leftJoinAndSelect('q.personalityDetails', 'personality')
      .leftJoinAndSelect('q.module', 'module')
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
  async moduleStats(): Promise<ModuleQuestionStats[]> {
    return this.dataSource.query<ModuleQuestionStats[]>(`
      SELECT m.id                                                    AS "moduleId",
             m.name                                                  AS name,
             m.slug                                                  AS slug,
             m."scoringType"                                         AS "scoringType",
             count(q.id)::int                                        AS total,
             count(q.id) FILTER (WHERE q.status = 'active')::int     AS active,
             count(q.id) FILTER (WHERE q.status = 'draft')::int      AS draft,
             count(q.id) FILTER (WHERE q.status = 'archived')::int   AS archived
      FROM modules m
      LEFT JOIN questions q ON q."moduleId" = m.id
      GROUP BY m.id, m.name, m.slug, m."scoringType"
      ORDER BY m.name
    `);
  }

  async findOne(id: string): Promise<Question> {
    const question = await this.questions.findOne({
      where: { id },
      relations: { mcqDetails: true, personalityDetails: true, module: true },
    });
    if (!question) throw new NotFoundException(`Question ${id} not found`);
    return question;
  }

  async update(id: string, dto: UpdateQuestionDto): Promise<Question> {
    const question = await this.findOne(id);
    const module = question.module;

    if (dto.mcq || dto.personality) {
      this.assertPayloadMatchesModule(module, dto.mcq, dto.personality);
    }

    await this.dataSource.transaction(async (manager) => {
      if (dto.questionText !== undefined)
        question.questionText = dto.questionText;
      if (dto.status !== undefined) question.status = dto.status;
      if (dto.tags !== undefined) question.tags = dto.tags;
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
          { options: dto.personality.options },
        );
      }
    });

    return this.findOne(id);
  }

  /**
   * Soft-remove: flip to `archived` so the selector stops serving the question
   * while its history stays intact. This is always safe, even for a question
   * candidates have already answered — nothing is destroyed.
   */
  async archive(id: string): Promise<Question> {
    const question = await this.findOne(id);
    question.status = QuestionStatus.ARCHIVED;
    return this.questions.save(question);
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
  async remove(id: string): Promise<{ id: string; deleted: true }> {
    const question = await this.findOne(id);

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

  async setStatus(id: string, status: QuestionStatus): Promise<Question> {
    const question = await this.findOne(id);
    question.status = status;
    return this.questions.save(question);
  }

  /**
   * Every rule that needs both the payload and its module. Shared by the
   * single-question endpoints and the bulk importer so the two can't drift.
   */
  assertPayloadMatchesModule(
    module: ModuleCatalogEntry,
    mcq: McqDetailsDto | undefined,
    personality: PersonalityDetailsDto | undefined,
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
    this.assertValidPersonality(module, personality);
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
  ): void {
    const keys = personality.options.map((o) => o.key);
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException('Option keys must be unique');
    }

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
      }
    }
  }
}
