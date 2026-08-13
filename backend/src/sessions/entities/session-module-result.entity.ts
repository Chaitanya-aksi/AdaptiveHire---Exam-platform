import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import type { ProbeResults } from '../../adaptive-engine/engine.types';
import { ModuleStopReason } from '../../common/enums';
import { ModuleCatalogEntry } from '../../modules-catalog/entities/module.entity';
import { AssessmentSession } from './assessment-session.entity';

export interface TraitScore {
  /** 0-100 on the reporting scale. */
  score: number;
  /** How much evidence there is, 0..1. */
  confidence: number;
  /**
   * How consistently the trait was expressed across situations, 0..1, or null
   * when fewer than two answers touched it.
   *
   * Optional because this is jsonb: results written before consistency existed
   * have no value for it, and absent must not read as measured.
   */
  consistency?: number | null;
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

  /** trait key -> score, confidence and consistency. Null for `objective`. */
  @Column({ type: 'jsonb', nullable: true })
  traitScores!: Record<string, TraitScore> | null;

  /**
   * Repeat-probe outcome: the pairs of twinned questions served far apart in
   * this module, and how closely each pair's two answers agreed.
   *
   * Null when the module opened no pair — no probe questions in the bank for it,
   * or the module was too short to fit a pair. Never null-as-zero: an absent
   * measurement must not read as perfect agreement.
   */
  @Column({ type: 'jsonb', nullable: true })
  probeResults!: ProbeResults | null;

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
