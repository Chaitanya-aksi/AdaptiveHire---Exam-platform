import {
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
} from 'typeorm';
import { Question } from './question.entity';

export interface McqOption {
  key: string;
  text: string;
}

/** Elo-scale midpoint, mirroring the candidate's starting ability estimate. */
export const DEFAULT_DIFFICULTY_SCORE = 1000;

@Entity('mcq_question_details')
export class McqQuestionDetails {
  @PrimaryColumn({ type: 'uuid' })
  questionId!: string;

  @OneToOne(() => Question, (question) => question.mcqDetails, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'questionId' })
  question!: Question;

  @Column({ type: 'jsonb' })
  options!: McqOption[];

  /** Matches one of `options[].key`. */
  @Column({ type: 'varchar', length: 16 })
  correctOption!: string;

  /**
   * Elo scale. Indexed because the question selector's hot path is
   * "closest difficulty to the candidate's current ability".
   */
  @Index()
  @Column({ type: 'integer', default: DEFAULT_DIFFICULTY_SCORE })
  difficultyScore!: number;

  @Column({ type: 'integer', default: 0 })
  timesUsed!: number;

  @Column({ type: 'integer', default: 0 })
  timesCorrect!: number;
}
