import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SessionStatus } from '../../common/enums';
import { Assessment } from '../../assessments/entities/assessment.entity';
import { Invitation } from '../../invitations/entities/invitation.entity';
import { User } from '../../users/entities/user.entity';
import { Response } from './response.entity';
import { SessionModuleResult } from './session-module-result.entity';

/**
 * Permanent record of one attempt. Written once at start and once at end —
 * live in-progress state (current question, running ability estimate, answered
 * question ids) lives in Redis, never here.
 */
@Entity('assessment_sessions')
@Index(['candidateId', 'status'])
export class AssessmentSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', unique: true })
  invitationId!: string;

  @OneToOne(() => Invitation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'invitationId' })
  invitation!: Invitation;

  @Column({ type: 'uuid' })
  assessmentId!: string;

  @ManyToOne(() => Assessment, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'assessmentId' })
  assessment!: Assessment;

  @Column({ type: 'uuid' })
  candidateId!: string;

  @ManyToOne(() => User, (user) => user.sessions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'candidateId' })
  candidate!: User;

  @Column({
    type: 'enum',
    enum: SessionStatus,
    default: SessionStatus.IN_PROGRESS,
  })
  status!: SessionStatus;

  @Column({ type: 'timestamptz' })
  startedAt!: Date;

  /** Server-authoritative deadline; the BullMQ auto-submit job is keyed off it. */
  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  submittedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => SessionModuleResult, (result) => result.session)
  moduleResults!: SessionModuleResult[];

  @OneToMany(() => Response, (response) => response.session)
  responses!: Response[];
}
