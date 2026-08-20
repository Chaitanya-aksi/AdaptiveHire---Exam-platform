import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { QuestionStatus } from '../common/enums';
import { ModuleCatalogEntry } from '../modules-catalog/entities/module.entity';
import { Question } from '../question-bank/entities/question.entity';
import { QUESTION_VISIBLE_TO_ORG } from '../question-bank/question-visibility';
import { CreateAssessmentDto } from './dto/create-assessment.dto';
import { AssessmentQuestion } from './entities/assessment-question.entity';
import { Assessment } from './entities/assessment.entity';

/**
 * The minimum a pool check needs to know about one module.
 *
 * Deliberately not the stored entity: the pool has to be validated *before* the
 * assessment is written, or a rejected pool leaves an assessment behind that the
 * caller was told had failed.
 */
interface PoolModuleConfig {
  moduleId: string;
  minQuestions: number;
  /** Recruiter-facing name, for the error message. */
  name: string;
}

@Injectable()
export class AssessmentsService {
  constructor(
    @InjectRepository(Assessment)
    private readonly assessments: Repository<Assessment>,
    @InjectRepository(ModuleCatalogEntry)
    private readonly modules: Repository<ModuleCatalogEntry>,
    @InjectRepository(Question)
    private readonly questions: Repository<Question>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Replaces an assessment's question pool.
   *
   * An empty list clears the pool, which means "no restriction" — the engine goes
   * back to drawing on everything the organisation can see. That is deliberately
   * not the same as "an assessment with no questions", which would be unusable.
   *
   * Written as delete-then-insert inside one transaction rather than a diff: the
   * pool is small, the caller sends the whole intended set, and a partially
   * applied change would leave an assessment nobody asked for.
   */
  async setQuestionPool(
    assessmentId: string,
    questionIds: string[],
    organisationId: string,
  ): Promise<Assessment> {
    const assessment = await this.findOne(assessmentId, organisationId);
    const unique = [...new Set(questionIds)];

    if (unique.length > 0) {
      await this.assertPoolIsUsable(
        assessment.modules.map((config) => ({
          moduleId: config.moduleId,
          minQuestions: config.minQuestions,
          name: config.module?.name ?? 'A section',
        })),
        unique,
        organisationId,
      );
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(AssessmentQuestion, { assessmentId });
      if (unique.length > 0) {
        await manager.insert(
          AssessmentQuestion,
          unique.map((questionId) => ({ assessmentId, questionId })),
        );
      }
    });

    return this.findOne(assessmentId, organisationId);
  }

  /**
   * Every way a pool can be wrong, checked before it is stored.
   *
   * The first check is the one that matters for tenancy: a pool is a list of ids
   * supplied by the client, so without it a recruiter could name another
   * organisation's private question and have their candidates served it. The
   * others stop a recruiter building an assessment that cannot run — a module
   * whose pool is thinner than its own minimum ends every attempt early with
   * `pool_exhausted`, and the report then reports low coverage for a
   * configuration mistake rather than anything the candidate did.
   */
  private async assertPoolIsUsable(
    configs: PoolModuleConfig[],
    questionIds: string[],
    organisationId: string,
  ): Promise<void> {
    const visible = await this.questions
      .createQueryBuilder('q')
      .select(['q.id', 'q.moduleId', 'q.status', 'q.isSample'])
      .where('q.id IN (:...questionIds)', { questionIds })
      .andWhere(QUESTION_VISIBLE_TO_ORG, { organisationId })
      .getMany();

    if (visible.length !== questionIds.length) {
      // Same message whether the id does not exist or belongs to another
      // organisation, so a pool cannot be used to probe for other customers' ids.
      const missing = questionIds.length - visible.length;
      throw new BadRequestException(
        `${missing} of the chosen question${missing === 1 ? '' : 's'} ` +
          `${missing === 1 ? 'is' : 'are'} not available to your organisation.`,
      );
    }

    // Named separately from the check above, because this one is a mistake the
    // recruiter can fix rather than an id they should not have: a practice
    // question is theirs and visible, it simply cannot be asked for real.
    const samples = visible.filter((q) => q.isSample);
    if (samples.length > 0) {
      throw new BadRequestException(
        `${samples.length} of the chosen question${samples.length === 1 ? ' is a' : 's are'} ` +
          'practice question' +
          `${samples.length === 1 ? '' : 's'}. Those are shown before the ` +
          'assessment starts, with the answer, so they cannot be asked in it.',
      );
    }

    const moduleIds = new Set(configs.map((c) => c.moduleId));
    const strays = visible.filter((q) => !moduleIds.has(q.moduleId));
    if (strays.length > 0) {
      throw new BadRequestException(
        `${strays.length} of the chosen question${strays.length === 1 ? '' : 's'} ` +
          `${strays.length === 1 ? 'belongs' : 'belong'} to a subject this ` +
          'assessment does not include.',
      );
    }

    // Only active questions can ever be served, so only they count towards a
    // module's minimum.
    for (const config of configs) {
      const usable = visible.filter(
        (q) =>
          q.moduleId === config.moduleId && q.status === QuestionStatus.ACTIVE,
      ).length;

      if (usable < config.minQuestions) {
        throw new BadRequestException(
          `${config.name} asks for at least ${config.minQuestions} questions but ` +
            `only ${usable} active question${usable === 1 ? '' : 's'} ` +
            `${usable === 1 ? 'was' : 'were'} chosen for it.`,
        );
      }
    }
  }

  /**
   * Creates an assessment together with its per-module configuration in one
   * save — the assessment_modules rows ride along on the entity's
   * `cascade: ['insert']` relation.
   */
  async create(
    dto: CreateAssessmentDto,
    organisationId: string,
    createdById: string,
  ): Promise<Assessment> {
    const moduleIds = dto.modules.map((m) => m.moduleId);

    if (new Set(moduleIds).size !== moduleIds.length) {
      throw new BadRequestException('The same module is listed more than once');
    }

    const found = await this.modules.find({ where: { id: In(moduleIds) } });
    if (found.length !== moduleIds.length) {
      throw new BadRequestException('One or more module ids do not exist');
    }
    const inactive = found.filter((m) => !m.isActive);
    if (inactive.length > 0) {
      throw new BadRequestException(
        `Cannot build an assessment on inactive module(s): ${inactive
          .map((m) => m.name)
          .join(', ')}`,
      );
    }

    for (const m of dto.modules) {
      if (m.maxQuestions < m.minQuestions) {
        throw new BadRequestException(
          'maxQuestions must be greater than or equal to minQuestions',
        );
      }
    }

    const opensAt = dto.opensAt ? new Date(dto.opensAt) : null;
    const closesAt = dto.closesAt ? new Date(dto.closesAt) : null;

    // A window that closes before it opens is unsittable rather than merely
    // odd — nobody could ever start it, and the failure would surface as a
    // confused candidate rather than as an error here.
    if (opensAt && closesAt && opensAt.getTime() >= closesAt.getTime()) {
      throw new BadRequestException(
        'That window closes before it opens. Check the dates.',
      );
    }

    const assessment = this.assessments.create({
      title: dto.title.trim(),
      description: dto.description?.trim() || null,
      organisationId,
      createdById,
      opensAt,
      closesAt,
      modules: dto.modules.map((m, index) => ({
        moduleId: m.moduleId,
        minQuestions: m.minQuestions,
        maxQuestions: m.maxQuestions,
        timeLimitSeconds: m.timeLimitSeconds,
        displayOrder: m.displayOrder ?? index,
      })),
    });

    const pool = [...new Set(dto.questionIds ?? [])];

    // Validated *before* anything is written. Checking afterwards left an
    // assessment behind on a rejected pool — the caller got a 400 and still
    // ended up with an assessment they never asked for.
    if (pool.length > 0) {
      await this.assertPoolIsUsable(
        dto.modules.map((m) => ({
          moduleId: m.moduleId,
          minQuestions: m.minQuestions,
          name: found.find((f) => f.id === m.moduleId)?.name ?? 'A section',
        })),
        pool,
        organisationId,
      );
    }

    // Assessment, its module config and its pool land together or not at all.
    const saved = await this.dataSource.transaction(async (manager) => {
      const stored = await manager.save(assessment);
      if (pool.length > 0) {
        await manager.insert(
          AssessmentQuestion,
          pool.map((questionId) => ({ assessmentId: stored.id, questionId })),
        );
      }
      return stored;
    });

    return this.findOne(saved.id, organisationId);
  }

  /**
   * Recruiter listing for one organisation — includes the module config so a
   * picker can show it.
   */
  findAll(organisationId: string): Promise<Assessment[]> {
    return this.assessments.find({
      where: { organisationId },
      // The pool comes along so the list can show whether an assessment is
      // curated or drawing on the whole bank, without a request per row.
      relations: { modules: { module: true }, questionPool: true },
      order: { createdAt: 'DESC', modules: { displayOrder: 'ASC' } },
    });
  }

  /**
   * One assessment, scoped to the organisation asking for it.
   *
   * `organisationId` is required rather than optional. An optional tenant filter
   * is a filter somebody eventually forgets to pass, and forgetting it here
   * would hand another company's assessment to whoever guessed the id. The
   * candidate runtime calls `findOneForSession` instead, which is explicit about
   * why it does not scope.
   */
  async findOne(id: string, organisationId: string): Promise<Assessment> {
    return this.load({ id, organisationId });
  }

  /**
   * Deletes an assessment and every trace of the attempts made on it.
   *
   * The database deliberately makes this impossible by accident:
   * `assessment_sessions.assessmentId` is `RESTRICT`, so an assessment somebody
   * has sat cannot simply be dropped. That guard exists to stop a stray delete
   * from silently taking hiring records with it — here the caller is explicitly
   * asking for exactly that, so the rows are removed in dependency order inside
   * one transaction.
   *
   * Order matters and is not stylistic:
   *   1. sessions — takes responses, reports, module results and proctoring
   *      logs with them, all four cascade from the session;
   *   2. invitations — `assessment_sessions.invitationId` is also `RESTRICT`,
   *      so these cannot go while an attempt still points at them;
   *   3. the assessment — its modules and question pool cascade from here.
   *
   * Candidate *accounts* are untouched. Someone who sat three of this
   * organisation's tests should not vanish because one of them was deleted; use
   * the People page to delete a person.
   *
   * Scoped by `organisationId`, so another company's assessment is a 404 rather
   * than a deletion.
   */
  async remove(
    id: string,
    organisationId: string,
  ): Promise<{ sessions: number; invitations: number }> {
    // Throws 404 if it is not this organisation's, before anything is deleted.
    await this.findOne(id, organisationId);

    return this.dataSource.transaction(async (manager) => {
      const sessions = await manager
        .createQueryBuilder()
        .delete()
        .from('assessment_sessions')
        .where(`"assessmentId" = :id`, { id })
        .execute();

      const invitations = await manager
        .createQueryBuilder()
        .delete()
        .from('invitations')
        .where(`"assessmentId" = :id`, { id })
        .execute();

      await manager.delete(Assessment, { id, organisationId });

      // `affected` rather than the length of a raw query's result: TypeORM
      // returns [rows, count] for a RETURNING delete, which always reads as 2.
      return {
        sessions: sessions.affected ?? 0,
        invitations: invitations.affected ?? 0,
      };
    });
  }

  /**
   * One assessment for the candidate runtime and the report layer, which reach
   * it through a session rather than through an organisation.
   *
   * Deliberately unscoped, and safe because of how it is reached: a session is
   * already tied to one candidate and one invitation, and the callers check that
   * ownership before they get here. A candidate has no organisation to filter
   * by, so demanding one would make the whole runtime unreachable.
   */
  async findOneForSession(id: string): Promise<Assessment> {
    return this.load({ id });
  }

  private async load(where: {
    id: string;
    organisationId?: string;
  }): Promise<Assessment> {
    const found = await this.assessments.findOne({
      where,
      // The pool comes back as ids only; the picker fetches the questions
      // themselves from the question bank, already filtered by visibility.
      relations: { modules: { module: true }, questionPool: true },
      order: { modules: { displayOrder: 'ASC' } },
    });
    // Same 404 for "no such assessment" and "not yours", so the API cannot be
    // used to discover which ids belong to other companies.
    if (!found) throw new NotFoundException(`Assessment ${where.id} not found`);
    return found;
  }
}
