import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { ModuleCatalogEntry } from '../../modules-catalog/entities/module.entity';
import { Question } from '../../question-bank/entities/question.entity';
import { AssessmentSession } from './assessment-session.entity';

/**
 * One row per answered question. `abilityEstimateAfter` and
 * `questionDifficultyAtServe` are long-lived production data used to tune the
 * adaptive engine later — not debug output.
 */
@Entity('responses')
@Unique(['sessionId', 'questionId'])
@Index(['sessionId', 'sequenceNumber'])
export class Response {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  @ManyToOne(() => AssessmentSession, (session) => session.responses, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'sessionId' })
  session!: AssessmentSession;

  @Column({ type: 'uuid' })
  moduleId!: string;

  @ManyToOne(() => ModuleCatalogEntry, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'moduleId' })
  module!: ModuleCatalogEntry;

  @Column({ type: 'uuid' })
  questionId!: string;

  @ManyToOne(() => Question, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'questionId' })
  question!: Question;

  /**
   * Option key the candidate picked. Null when the module timed out with the
   * question unanswered, and null for ranking questions — those record their
   * whole ordering in `selectedOptions` instead.
   */
  @Column({ type: 'varchar', length: 16, nullable: true })
  selectedOption!: string | null;

  /**
   * Ordered option keys for a ranking question, strongest preference first.
   * Order is the answer here, so it is stored verbatim and never sorted.
   *
   * Exactly one of `selectedOption` / `selectedOptions` is set on an answered
   * question; both are null when the clock ran out on it.
   */
  @Column({ type: 'jsonb', nullable: true })
  selectedOptions!: string[] | null;

  /** Null for `trait` modules — there is no right answer there. */
  @Column({ type: 'boolean', nullable: true })
  isCorrect!: boolean | null;

  @Column({ type: 'numeric', precision: 8, scale: 2, nullable: true })
  abilityEstimateAfter!: string | null;

  /** Snapshot — the question's difficulty drifts as more candidates see it. */
  @Column({ type: 'numeric', precision: 8, scale: 2, nullable: true })
  questionDifficultyAtServe!: string | null;

  /** Position within the whole session, 1-based. */
  @Column({ type: 'integer' })
  sequenceNumber!: number;

  @Column({ type: 'integer', nullable: true })
  timeTakenMs!: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  answeredAt!: Date;
}
