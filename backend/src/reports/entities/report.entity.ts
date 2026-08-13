import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { HiringRecommendation } from '../../common/enums';
import { AssessmentSession } from '../../sessions/entities/assessment-session.entity';

/**
 * The summary layer only. Question-by-question answers and the proctoring
 * event list are deliberately NOT duplicated here — the detail view queries
 * `responses` and `proctoring_logs` live.
 */
@Entity('reports')
export class Report {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', unique: true })
  sessionId!: string;

  @OneToOne(() => AssessmentSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session!: AssessmentSession;

  @Column({ type: 'text' })
  summary!: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  strengths!: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  weaknesses!: string[];

  @Column({ type: 'enum', enum: HiringRecommendation })
  hiringRecommendation!: HiringRecommendation;

  /**
   * The headline 0-100 figure the recommendation was banded on: `abilityScore`
   * and `behavioralScore` blended. Kept for list sorting.
   */
  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  overallScore!: string | null;

  /**
   * The two halves behind `overallScore`, stored separately so the attempts
   * list can show where a blended figure came from without rebuilding the whole
   * report. Either is null when the assessment had no section of that kind.
   */
  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  abilityScore!: string | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  behavioralScore!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  generatedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
