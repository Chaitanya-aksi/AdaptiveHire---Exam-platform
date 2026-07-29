import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ScoringType } from '../../common/enums';
import { Question } from '../../question-bank/entities/question.entity';

/**
 * One trait a `trait` module measures.
 *
 * `key` is what the engine scores against and what `trait_weights` on a
 * question option references — Big Five keys, kept stable and psychometrically
 * conventional. `label` is what a recruiter sees; the report never shows the
 * raw key.
 */
export interface TraitDefinition {
  /** Engine-facing, e.g. 'conscientiousness'. Never rendered in the UI. */
  key: string;
  /** Recruiter-facing, e.g. 'Reliability & Follow-Through'. */
  label: string;
  /**
   * Report the inverse of the measured score. Needed where the workplace
   * framing is the opposite pole of the Big Five trait — 'neuroticism'
   * surfaces as 'Resilience Under Pressure', so a high raw score must render
   * as a low reported one.
   */
  invertForReport?: boolean;
}

/**
 * A subject (Aptitude, Logical, Personality, ...). Reference data, not an
 * enum — new subjects are inserted as rows, no code change needed, as long as
 * they fit one of the two scoring types.
 */
@Entity('modules')
export class ModuleCatalogEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 120 })
  slug!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'enum', enum: ScoringType })
  scoringType!: ScoringType;

  /**
   * The traits this module measures. Only meaningful for `trait` modules —
   * the question selector reads it to find the trait with the least coverage
   * so far, and the report layer reads it for display labels.
   *
   * Stored as jsonb rather than text[] so a new trait module can define its
   * own labels as pure data, with no code change.
   */
  @Column({ type: 'jsonb', nullable: true })
  traits!: TraitDefinition[] | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => Question, (question) => question.module)
  questions!: Question[];
}
