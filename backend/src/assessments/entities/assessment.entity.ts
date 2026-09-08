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
