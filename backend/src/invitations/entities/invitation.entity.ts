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
import { InvitationSource, InvitationStatus } from '../../common/enums';
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

  /**

   * This candidate's own window, overriding the assessment's.

   *

   * Null means "inherit", not "no bound" — so rescheduling somebody's

   * start time cannot accidentally remove their deadline.

   */

  @Column({ type: 'timestamptz', nullable: true })
  opensAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  /**
   * Whether a recruiter invited this address or the candidate typed it in
   * themselves through a public link.
   *
   * Defaults to `recruiter`, which is what every row created before public
   * links existed genuinely was — so no backfill was needed and no historic
   * attempt is mislabelled.
   *
   * This is not bookkeeping. An invited attempt is evidence about a named
   * person because somebody vouched for the address; a self-registered one is
   * evidence about whoever typed it. The results list and the report both show
   * the difference, because a recruiter comparing two candidates deserves to
   * know which is which.
   */
  @Index()
  @Column({
    type: 'enum',
    enum: InvitationSource,
    default: InvitationSource.RECRUITER,
  })
  source!: InvitationSource;

  /**
   * Where the candidate was when they claimed this invitation, and with what.
   *
   * Null for every recruiter-created invitation, since nobody registered.
   *
   * **Recorded and shown, never enforced.** Refusing a repeat IP was considered
   * and rejected: a college, an office or a household shares one address, and
   * Indian mobile carriers put thousands of users behind carrier-grade NAT, so
   * it would turn away legitimate candidates in bulk while a VPN defeats it in
   * seconds — many false rejections, few true ones, which is the worst shape a
   * gate can have. Recording it lets a recruiter notice that three attempts came
   * from one address and judge for themselves, which is the same rule the whole
   * proctoring stack runs on.
   *
   * 45 characters because an IPv6 address with an embedded IPv4 suffix is the
   * longest form we can be handed.
   */
  @Column({ type: 'varchar', length: 45, nullable: true })
  registeredIp!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  registeredUserAgent!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
