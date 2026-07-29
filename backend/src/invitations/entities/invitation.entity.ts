import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { InvitationStatus } from '../../common/enums';
import { Assessment } from '../../assessments/entities/assessment.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Grants a candidate access to an assessment. There is no magic-link token —
 * the invite email points at the login page, the candidate registers/logs in,
 * and the assessment shows up in their list.
 *
 * The invitation is keyed by `email`, not by `candidateId`. A recruiter can
 * invite someone who has no account yet: the row is created with `email` set
 * and `candidateId` null, and `candidateId` is backfilled when that person
 * registers with the matching address. `email` is therefore the stable natural
 * key — hence the unique constraint on (assessmentId, email).
 */
@Entity('invitations')
@Unique(['assessmentId', 'email'])
export class Invitation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  assessmentId!: string;

  @ManyToOne(() => Assessment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assessmentId' })
  assessment!: Assessment;

  /** Lowercased invitee address — set at upload, before any account exists. */
  @Index()
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  /**
   * Null until the invitee registers with the matching email, then backfilled.
   * A pending invite for someone who has not signed up yet has no user row to
   * point at, which is exactly why this is nullable.
   */
  @Column({ type: 'uuid', nullable: true })
  candidateId!: string | null;

  @ManyToOne(() => User, (user) => user.invitations, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'candidateId' })
  candidate!: User | null;

  @Column({ type: 'uuid', nullable: true })
  invitedById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'invitedById' })
  invitedBy!: User | null;

  @Column({
    type: 'enum',
    enum: InvitationStatus,
    default: InvitationStatus.PENDING,
  })
  status!: InvitationStatus;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
