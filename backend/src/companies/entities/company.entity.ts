import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Organisation } from '../../organisations/entities/organisation.entity';

/**
 * One business within a customer's group — the name and logo a candidate
 * actually sees, as opposed to the account that hosts the assessment.
 *
 * The distinction this exists to draw: an `organisation` is the **workspace**.
 * It is the tenancy boundary, it owns the question bank and the assessments,
 * and it is who pays. A `company` is one of the businesses that workspace hires
 * for. A group with six subsidiaries has one organisation and six companies,
 * one login, one question bank, and six different logos on the candidate's
 * screen depending on which business the round is for.
 *
 * Before this, branding lived on the organisation alone, so every candidate a
 * group invited saw the parent's mark whichever subsidiary they had actually
 * applied to. That is wrong in the way that matters most: the candidate applied
 * to a company, and the assessment should look like it came from that company.
 *
 * Scoped, like everything else recruiter-facing. `organisationId` is NOT NULL
 * and every query filters on it — a company carries a logo URL and a name that
 * one customer typed, and one customer's group structure is not another's to
 * read. There is deliberately no platform-owned company: unlike the question
 * bank, there is no such thing as a starter brand everyone can use.
 */
@Entity('companies')
@Index(['organisationId', 'isActive'])
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * The workspace this company belongs to, and the tenancy boundary.
   *
   * `CASCADE`: a deleted workspace takes its group structure with it. There is
   * nothing to keep — a company is meaningless without the organisation whose
   * assessments point at it.
   */
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  /** As a candidate should see it — "KhetPilot", not a legal entity name. */
  @Column({ type: 'varchar', length: 200 })
  name!: string;

  /**
   * Logo shown to candidates, as an absolute https URL.
   *
   * A URL rather than an upload, the same trade the organisation's own logo
   * makes: file storage, scanning and a CDN are a whole subsystem, and a
   * company with a logo already has it hosted. Null falls back to the initial
   * badge the portal draws from the name.
   */
  @Column({ type: 'varchar', length: 2048, nullable: true })
  logoUrl!: string | null;

  /**
   * Accent as `#rrggbb`, or null to inherit the organisation's.
   *
   * Worth having per company rather than per workspace: the point of this table
   * is that the subsidiaries are visibly different businesses, and a group whose
   * six brands share one colour has not achieved that.
   */
  @Column({ type: 'varchar', length: 7, nullable: true })
  accentColor!: string | null;

  /**
   * Where a candidate writes about an assessment for this company, or null to
   * fall back to the organisation's address and then the platform's.
   *
   * Optional because a group commonly runs one shared recruiting inbox. The
   * fallback chain means leaving it blank is a real answer rather than a gap.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  supportEmail!: string | null;

  /**
   * Retired rather than deleted.
   *
   * A company that stops hiring still has assessments and reports pointing at
   * it, and the candidate who sat one applied to *that* business — rewriting
   * their record to the parent's name years later would falsify it. Inactive
   * companies drop out of the picker and stay on everything already made.
   */
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
