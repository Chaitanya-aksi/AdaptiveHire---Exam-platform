import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ScoringType } from '../common/enums';
import { CreateModuleDto } from './dto/create-module.dto';
import { UpdateModuleDto } from './dto/update-module.dto';
import { ModuleCatalogEntry } from './entities/module.entity';

@Injectable()
export class ModulesCatalogService {
  constructor(
    @InjectRepository(ModuleCatalogEntry)
    private readonly modules: Repository<ModuleCatalogEntry>,
  ) {}

  findAll(includeInactive = false): Promise<ModuleCatalogEntry[]> {
    return this.modules.find({
      where: includeInactive ? {} : { isActive: true },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<ModuleCatalogEntry> {
    const found = await this.modules.findOne({ where: { id } });
    if (!found) throw new NotFoundException(`Module ${id} not found`);
    return found;
  }

  async findBySlug(slug: string): Promise<ModuleCatalogEntry> {
    const found = await this.modules.findOne({ where: { slug } });
    if (!found) throw new NotFoundException(`Module "${slug}" not found`);
    return found;
  }

  async create(dto: CreateModuleDto): Promise<ModuleCatalogEntry> {
    this.assertTraitsMatchScoringType(dto.scoringType, dto.traits);

    const clash = await this.modules.findOne({
      where: [{ slug: dto.slug }, { name: dto.name }],
    });
    if (clash) {
      throw new ConflictException(
        `A module with that ${clash.slug === dto.slug ? 'slug' : 'name'} already exists`,
      );
    }

    return this.modules.save(this.modules.create(dto));
  }

  async update(id: string, dto: UpdateModuleDto): Promise<ModuleCatalogEntry> {
    const module = await this.findOne(id);

    if (dto.traits !== undefined) {
      this.assertTraitsMatchScoringType(module.scoringType, dto.traits);
    }
    if (dto.name && dto.name !== module.name) {
      const clash = await this.modules.findOne({ where: { name: dto.name } });
      if (clash) throw new ConflictException('That module name is taken');
    }

    Object.assign(module, dto);
    return this.modules.save(module);
  }

  /**
   * Modules are never hard-deleted — questions, assessment_modules and
   * session results all reference them (ON DELETE RESTRICT). Deactivating
   * hides a module from new assessments while leaving history intact.
   */
  async deactivate(id: string): Promise<ModuleCatalogEntry> {
    const module = await this.findOne(id);
    module.isActive = false;
    return this.modules.save(module);
  }

  private assertTraitsMatchScoringType(
    scoringType: ScoringType,
    traits: unknown[] | undefined,
  ): void {
    if (scoringType === ScoringType.TRAIT && (!traits || traits.length === 0)) {
      throw new BadRequestException(
        'A trait module must declare at least one trait',
      );
    }
    if (scoringType === ScoringType.OBJECTIVE && traits && traits.length > 0) {
      throw new BadRequestException(
        'An objective module is Elo-scored and cannot declare traits',
      );
    }
  }
}
