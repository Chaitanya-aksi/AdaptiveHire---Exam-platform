import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { BehavioralPattern } from '../../common/enums';
import { Question } from './question.entity';

export interface PersonalityOption {
  key: string;
  text: string;
  /** trait key -> weight contributed when this option is chosen. */
  traitWeights: Record<string, number>;
  /**
   * Optional categorical label for the tendency this option expresses
   * ('Collaborative', 'Independent', 'Planning', 'Ownership').
   *
   * Never scored — the trait weights do that. It exists so the recruiter's
   * evidence view can say which behaviour was chosen in each scenario without
   * making them re-read every option's full wording.
   */
  behavior?: string;
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

  /**
   * Which behavioural pattern this question uses. Null means a legacy
   * agree/disagree item predating the behavioural engine — still servable,
   * deliberately rare, and never offered when authoring something new.
   */
  @Column({
    type: 'enum',
    enum: BehavioralPattern,
    nullable: true,
  })
  pattern!: BehavioralPattern | null;

  @Column({ type: 'integer', default: 0 })
  timesUsed!: number;
}
