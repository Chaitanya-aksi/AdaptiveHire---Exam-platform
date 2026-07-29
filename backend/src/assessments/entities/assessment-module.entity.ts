import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { ModuleCatalogEntry } from '../../modules-catalog/entities/module.entity';
import { Assessment } from './assessment.entity';

/**
 * Per-assessment configuration of one module: how many questions the adaptive
 * engine may ask and how long the candidate gets.
 */
@Entity('assessment_modules')
@Unique(['assessmentId', 'moduleId'])
export class AssessmentModule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  assessmentId!: string;

  @ManyToOne(() => Assessment, (assessment) => assessment.modules, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'assessmentId' })
  assessment!: Assessment;

  @Column({ type: 'uuid' })
  moduleId!: string;

  @ManyToOne(() => ModuleCatalogEntry, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'moduleId' })
  module!: ModuleCatalogEntry;

  /** Floor enforced by the stopping engine before confidence can end a module. */
  @Column({ type: 'integer' })
  minQuestions!: number;

  @Column({ type: 'integer' })
  maxQuestions!: number;

  @Column({ type: 'integer' })
  timeLimitSeconds!: number;

  @Column({ type: 'integer', default: 0 })
  displayOrder!: number;
}
