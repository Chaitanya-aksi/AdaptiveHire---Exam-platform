import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ModuleCatalogEntry } from '../modules-catalog/entities/module.entity';
import { CreateAssessmentDto } from './dto/create-assessment.dto';
import { Assessment } from './entities/assessment.entity';

@Injectable()
export class AssessmentsService {
  constructor(
    @InjectRepository(Assessment)
    private readonly assessments: Repository<Assessment>,
    @InjectRepository(ModuleCatalogEntry)
    private readonly modules: Repository<ModuleCatalogEntry>,
  ) {}

  /**
   * Creates an assessment together with its per-module configuration in one
   * save — the assessment_modules rows ride along on the entity's
   * `cascade: ['insert']` relation.
   */
  async create(
    dto: CreateAssessmentDto,
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

    const assessment = this.assessments.create({
      title: dto.title.trim(),
      description: dto.description?.trim() || null,
      createdById,
      modules: dto.modules.map((m, index) => ({
        moduleId: m.moduleId,
        minQuestions: m.minQuestions,
        maxQuestions: m.maxQuestions,
        timeLimitSeconds: m.timeLimitSeconds,
        displayOrder: m.displayOrder ?? index,
      })),
    });

    const saved = await this.assessments.save(assessment);
    return this.findOne(saved.id);
  }

  /** Recruiter listing — includes the module config so a picker can show it. */
  findAll(): Promise<Assessment[]> {
    return this.assessments.find({
      relations: { modules: { module: true } },
      order: { createdAt: 'DESC', modules: { displayOrder: 'ASC' } },
    });
  }

  async findOne(id: string): Promise<Assessment> {
    const found = await this.assessments.findOne({
      where: { id },
      relations: { modules: { module: true } },
      order: { modules: { displayOrder: 'ASC' } },
    });
    if (!found) throw new NotFoundException(`Assessment ${id} not found`);
    return found;
  }
}
