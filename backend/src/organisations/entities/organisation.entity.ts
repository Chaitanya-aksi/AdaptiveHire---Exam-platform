import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * One hiring company on the platform, and the boundary every recruiter-facing
 * query is filtered by.
 *
 * This exists because recruiters register themselves. When accounts were seeded
 * by hand every recruiter was a trusted colleague, so nothing needed scoping;
 * the moment a stranger can sign up, "no scoping" means they can read every
 * other company's assessments and every candidate's report. The organisation is
 * what makes that impossible.
 *
 * Candidates deliberately do NOT belong to one. A candidate is a person, not a
 * customer's record — the same account sits assessments for as many companies as
 * invite them, which is why invitations are keyed on email and a candidate's
 * `organisationId` stays null.
 */
@Entity('organisations')
export class Organisation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The company name as the recruiter typed it, shown in the UI. */
  @Column({ type: 'varchar', length: 200 })
  name!: string;

  /**
   * URL-safe form of the name, unique across the platform.
   *
   * Unique so two companies cannot end up indistinguishable in a URL or an
   * export. Collisions are resolved at registration by appending a counter
   * rather than rejecting the signup — a second "Acme" is a real company, not a
   * mistake to send back to the user.
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 220 })
  slug!: string;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => User, (user) => user.organisation)
  members!: User[];
}
