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
