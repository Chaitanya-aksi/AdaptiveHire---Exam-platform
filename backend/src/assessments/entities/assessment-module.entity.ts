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

  /**
   * Exactly how many questions this section asks.
   *
   * One number, not a range. It replaced `minQuestions`/`maxQuestions`, which
   * let the stopping engine end a section early once confidence was reached —
   * so two candidates sat the same section and answered a different number of
   * questions. Sections are now fixed length; the *difficulty* still adapts
   * question by question, which is what makes it an adaptive test.
   */
  @Column({ type: 'integer' })
  questionCount!: number;

  @Column({ type: 'integer' })
  timeLimitSeconds!: number;

  @Column({ type: 'integer', default: 0 })
  displayOrder!: number;
}
