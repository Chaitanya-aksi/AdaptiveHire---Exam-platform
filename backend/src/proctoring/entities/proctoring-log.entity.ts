import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ProctoringEventType } from '../../common/enums';
import { AssessmentSession } from '../../sessions/entities/assessment-session.entity';

/**
 * One row per security event. Detect and log for recruiter judgment — never
 * auto-disqualify.
 *
 * The (sessionId, occurredAt) index is also the intended pruning key for the
 * retention job planned after v1.
 */
@Entity('proctoring_logs')
@Index(['sessionId', 'occurredAt'])
export class ProctoringLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  @ManyToOne(() => AssessmentSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session!: AssessmentSession;

  @Column({ type: 'enum', enum: ProctoringEventType })
  eventType!: ProctoringEventType;

  /** Client-reported event time; `createdAt` is when the server stored it. */
  @Column({ type: 'timestamptz' })
  occurredAt!: Date;

  /** Free-form event context, e.g. { faceCount: 2 } or { screenCount: 3 }. */
  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
