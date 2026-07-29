import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { ModuleStopReason } from '../../common/enums';
import { ModuleCatalogEntry } from '../../modules-catalog/entities/module.entity';
import { AssessmentSession } from './assessment-session.entity';

export interface TraitScore {
  score: number;
  confidence: number;
}

@Entity('session_module_results')
@Unique(['sessionId', 'moduleId'])
export class SessionModuleResult {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  @ManyToOne(() => AssessmentSession, (session) => session.moduleResults, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'sessionId' })
  session!: AssessmentSession;

  @Column({ type: 'uuid' })
  moduleId!: string;

  @ManyToOne(() => ModuleCatalogEntry, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'moduleId' })
  module!: ModuleCatalogEntry;

  /** Final Elo-scale ability estimate. Null for `trait` modules. */
  @Column({ type: 'numeric', precision: 8, scale: 2, nullable: true })
  abilityScore!: string | null;

  /** trait key -> { score, confidence }. Null for `objective` modules. */
  @Column({ type: 'jsonb', nullable: true })
  traitScores!: Record<string, TraitScore> | null;

  @Column({ type: 'integer', default: 0 })
  questionsAnswered!: number;

  @Column({ type: 'integer', default: 0 })
  questionsCorrect!: number;

  @Column({ type: 'enum', enum: ModuleStopReason, nullable: true })
  stopReason!: ModuleStopReason | null;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
}
