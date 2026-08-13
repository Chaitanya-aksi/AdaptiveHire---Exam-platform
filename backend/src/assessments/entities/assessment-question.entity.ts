import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Question } from '../../question-bank/entities/question.entity';
import { Assessment } from './assessment.entity';

/**
 * One question a recruiter has approved for one assessment — the assessment's
 * question pool.
 *
 * The pool narrows what the adaptive engine may draw from; it does not replace
 * it. The engine still chooses question by question on difficulty match and trait
 * coverage, so two candidates sitting the same assessment still get different
 * papers of different lengths. Picking a fixed list in a fixed order would have
 * meant no adaptation at all, which is the point of the product.
 *
 * **No rows for an assessment means no restriction** — every question visible to
 * the owning organisation is eligible. That is the default on a newly created
 * assessment, and it is what keeps assessments made before pools existed working
 * untouched. Curating is opt-in.
 *
 * A composite primary key rather than a surrogate id: the pair *is* the fact, and
 * it makes a question impossible to add to the same assessment twice.
 */
@Entity('assessment_questions')
export class AssessmentQuestion {
  @PrimaryColumn({ type: 'uuid' })
  assessmentId!: string;

  @ManyToOne(() => Assessment, (assessment) => assessment.questionPool, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'assessmentId' })
  assessment!: Assessment;

  @PrimaryColumn({ type: 'uuid' })
  questionId!: string;

  /**
   * Cascades on delete so a removed question simply drops out of every pool.
   * Deleting a question is only permitted when nobody has answered it, so this
   * can never discard a pool entry that a stored result depends on.
   */
  @ManyToOne(() => Question, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'questionId' })
  question!: Question;
}
