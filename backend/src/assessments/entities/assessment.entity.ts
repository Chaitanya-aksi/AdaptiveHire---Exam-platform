import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Company } from '../../companies/entities/company.entity';
import { Organisation } from '../../organisations/entities/organisation.entity';
import { User } from '../../users/entities/user.entity';
import { AssessmentModule } from './assessment-module.entity';
import { AssessmentQuestion } from './assessment-question.entity';

/** A named test made of one or more modules. */
@Entity('assessments')
export class Assessment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  /**
   * The company that owns this assessment. Every recruiter-facing query filters
   * on it, so this is what stops one customer reading another's tests,
   * candidates and reports.
   *
   * Not null: an assessment with no owner would be visible to nobody and
   * scopeable by nothing. `createdById` below is a separate fact — which person
   * made it — and is nullable because that person's account may later be
   * deleted while the company's assessment survives.
   */
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  /**
   * Which business in the group this round is for, or null for the workspace
   * itself.
   *
   * This is what a candidate is shown: their invitation, their assessment card
   * and their record all carry this company's name and logo, falling back to
   * the organisation's own when it is null. It is presentation, never scope —
   * `organisationId` above is the tenancy boundary and stays the only thing any
   * query filters on. A company from another workspace is refused on write.
   *
   * Nullable, and null is what every assessment created before group companies
   * existed has. A customer who is a single company never sets it.
   */
  @Column({ type: 'uuid', nullable: true })
  companyId!: string | null;

  /**
   * `SET NULL` on delete: removing a company falls its assessments back to the
   * organisation's branding rather than deleting rounds, sessions and reports
   * along with a tidied-up dropdown. Retiring a company is the better route and
   * leaves this pointing where it did.
   */
  @ManyToOne(() => Company, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'companyId' })
  company!: Company | null;

  /*
   * ── Public link ────────────────────────────────────────────────────────
   *
   * A shareable link that lets a candidate reach this assessment without an
   * emailed invitation. Every field below is null or false until somebody
   * turns it on, so an assessment that never uses one behaves exactly as it
   * did before this existed.
   *
   * See `docs/public-assessment-links.md` for what this deliberately gives up:
   * with an open link the email is self-asserted, so a self-registered attempt
   * is weaker evidence about a person than an invited one, and both the results
   * list and the report say so.
   */

  /**
   * SHA-256 of the token, never the token itself.
   *
   * The token is a credential — whoever holds it can start an attempt and see
   * questions from a curated bank. Storing it in the clear would put a live
   * credential in every database backup for no benefit: it is generated once,
   * shown to the recruiter once, and only ever compared against afterwards.
   * Same reasoning as `password_reset_tokens`.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  publicLinkTokenHash!: string | null;

  /**
   * An off switch that does not destroy the token.
   *
   * Separate from the hash so a recruiter can close a round and reopen it
   * without reissuing a link they have already shared with a cohort.
   */
  @Column({ type: 'boolean', default: false })
  publicLinkEnabled!: boolean;

  /**
   * When the link stops working, independent of the assessment's own window.
   *
   * Null means it is bound by `closesAt` instead, or is open-ended when there
   * is no window either — the same "null means inherit, not unbounded" rule the
   * per-invitation overrides follow.
   */
  @Column({ type: 'timestamptz', nullable: true })
  publicLinkExpiresAt!: Date | null;

  /**
   * How many attempts the link may create in total, or null for no cap.
   *
   * The blast radius control for a leaked link: without it, a URL posted
   * somewhere public can be used to mine the question bank indefinitely.
   */
  @Column({ type: 'integer', nullable: true })
  publicLinkMaxAttempts!: number | null;

  /**
   * Restricts entry to one email domain, e.g. a single college for a campus
   * drive. Null accepts any address.
   *
   * The single most effective narrowing available once there is no invited
   * list, and the reason it is worth having in the first version.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  publicLinkEmailDomain!: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'createdById' })
  createdBy!: User | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  /**
   * The scheduled window, stored as an instant.
   *
   * Null means no bound, so an assessment with neither is always open — which
   * is what every assessment created before windows existed has, and why
   * adding this changed nothing for them.
   *
   * An invitation may override either end for one candidate. The two are
   * combined in exactly one place, `assessment-window.ts`, so the runtime and
   * the candidate's own list can never disagree about whether a test is open.
   */
  @Column({ type: 'timestamptz', nullable: true })
  opensAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  closesAt!: Date | null;

  @OneToMany(
    () => AssessmentModule,
    (assessmentModule) => assessmentModule.assessment,
    { cascade: ['insert'] },
  )
  modules!: AssessmentModule[];

  /**
   * The questions this assessment may draw from, or empty for "no restriction".
   *
   * Empty is the default and is not the same as "no questions": the engine then
   * uses everything visible to the owning organisation. Only a curated pool
   * narrows it.
   */
  @OneToMany(
    () => AssessmentQuestion,
    (assessmentQuestion) => assessmentQuestion.assessment,
  )
  questionPool!: AssessmentQuestion[];
}
