import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { Question } from './question.entity';

export interface PersonalityOption {
  key: string;
  text: string;
  /** trait key -> weight contributed when this option is chosen. */
  traitWeights: Record<string, number>;
}

@Entity('personality_question_details')
export class PersonalityQuestionDetails {
  @PrimaryColumn({ type: 'uuid' })
  questionId!: string;

  @OneToOne(() => Question, (question) => question.personalityDetails, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'questionId' })
  question!: Question;

  @Column({ type: 'jsonb' })
  options!: PersonalityOption[];

  @Column({ type: 'integer', default: 0 })
  timesUsed!: number;
}
