import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { QuestionStatus } from '../../common/enums';
import { ModuleCatalogEntry } from '../../modules-catalog/entities/module.entity';
import { Organisation } from '../../organisations/entities/organisation.entity';
import { User } from '../../users/entities/user.entity';
import { McqQuestionDetails } from './mcq-question-details.entity';
import { PersonalityQuestionDetails } from './personality-question-details.entity';

/**
 * Shared parent row for every question. The scoring-type-specific payload
 * lives in one of the two 1:1 child tables.
 */
@Entity('questions')
@Index(['moduleId', 'status'])
export class Question {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  moduleId!: string;

  @ManyToOne(() => ModuleCatalogEntry, (module) => module.questions, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'moduleId' })
  module!: ModuleCatalogEntry;

  @Column({ type: 'text' })
  questionText!: string;

  @Column({
    type: 'enum',
    enum: QuestionStatus,
    default: QuestionStatus.DRAFT,
  })
  status!: QuestionStatus;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  tags!: string[];

  /**
   * Marks this question as one of a pair (or small set) that measure the same
   * thing in different clothing — a repeat probe.
   *
   * Questions sharing a `probeGroup` are twins: the same underlying construct,
   * a reworded stem, and reworded, reordered options. The selector serves one
   * of them early, waits out `PROBE_GAP_QUESTIONS`, then serves a twin, and the
   * two answers are compared. A candidate who answers the same situation two
   * different ways without recognising it as the same situation is telling us
   * something the first answer alone could not.
   *
   * Null for the vast majority of questions, which stand on their own.
   */
  @Index()
  @Column({ type: 'varchar', length: 80, nullable: true })
  probeGroup!: string | null;

  /**
   * The company that authored this question, or null for a platform question.
   *
   * Null is a meaningful value here, not a missing one. A platform question is
   * part of the starter bank that ships with AdaptiveHire: every organisation
   * can see it and put it in an assessment, and none of them can edit or archive
   * it — one customer must not be able to reword a question another customer's
   * live assessment depends on.
   *
   * A question with an organisation set is private to that organisation: only
   * they can see it, only they can change it. So the rule everywhere is
   * "visible if `organisationId IS NULL` OR it matches mine", and
   * "writable only if it matches mine".
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  organisationId!: string | null;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation | null;

  /**
   * The platform question this one is a private copy of, or null.
   *
   * Set when an organisation edits or hides a platform question: rather than
   * change shared content, it takes a fork. The fork then *replaces* the original
   * wherever that organisation looks — its bank, and the questions its candidates
   * are served — while every other organisation still sees the pristine one.
   *
   * A fork with `status = 'archived'` is how an organisation hides a platform
   * question from itself. Deleting a fork reverts them to the platform version,
   * because the original becomes visible again the moment the fork is gone.
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  forkedFromId!: string | null;

  @ManyToOne(() => Question, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'forkedFromId' })
  forkedFrom!: Question | null;

  @Column({ type: 'uuid', nullable: true })
  createdById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'createdById' })
  createdBy!: User | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @OneToOne(() => McqQuestionDetails, (details) => details.question)
  mcqDetails!: McqQuestionDetails | null;

  @OneToOne(() => PersonalityQuestionDetails, (details) => details.question)
  personalityDetails!: PersonalityQuestionDetails | null;
}
