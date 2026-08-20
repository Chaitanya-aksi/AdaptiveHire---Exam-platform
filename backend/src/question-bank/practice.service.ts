import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BehavioralPattern,
  QuestionStatus,
  ScoringType,
} from '../common/enums';
import { Question } from './entities/question.entity';
import { QUESTION_VISIBLE_TO_ORG } from './question-visibility';

/**
 * How many practice questions to aim for in total.
 *
 * A total rather than an allowance per subject, because the right answer
 * depends on the shape of the assessment. Three subjects should give one
 * apiece — that is a tour of what is coming. One subject should still give
 * three, because a single question is not a rehearsal: a candidate who answers
 * once has seen the control work once and learned nothing about the pacing.
 *
 * Three, not ten. This is a rehearsal of the controls, not a mock exam, and
 * every extra question is one more thing between a candidate and the test they
 * came to sit.
 */
const PRACTICE_TARGET = 3;

/** A practice question, with the answer, because that is the point of it. */
export interface PracticeQuestion {
  id: string;
  /** Which subject it stands in for, so the candidate knows what it previews. */
  moduleName: string;
  scoringType: ScoringType;
  text: string;
  options: { key: string; text: string }[];
  /** Drives the same renderer the real test uses. Null means single-choice. */
  pattern: BehavioralPattern | null;
  /**
   * The right answer, revealed after they choose.
   *
   * Null for every trait question — not "unknown", but *there isn't one*, which
   * is itself the most useful thing practice can teach somebody about a
   * personality section. Sending it for objective questions is safe precisely
   * because a sample can never be served for real: the selector and the pool
   * validator both refuse it.
   */
  correctOption: string | null;
}

@Injectable()
export class PracticeService {
  constructor(
    @InjectRepository(Question)
    private readonly questions: Repository<Question>,
  ) {}

  /**
   * Practice questions for the subjects one assessment actually contains.
   *
   * Scoped to the organisation like every other question read, so a company
   * that has written its own samples shows those and never another customer's.
   *
   * Returns an empty array when nobody has authored any, and the caller is
   * expected to skip the step rather than block on it — practice is a courtesy,
   * and a bank with no samples yet must not stop anyone sitting an assessment.
   */
  async forModules(
    moduleIds: string[],
    organisationId: string,
  ): Promise<PracticeQuestion[]> {
    if (moduleIds.length === 0) return [];

    const rows = await this.questions
      .createQueryBuilder('q')
      .leftJoinAndSelect('q.mcqDetails', 'mcq')
      .leftJoinAndSelect('q.personalityDetails', 'personality')
      .leftJoinAndSelect('q.module', 'module')
      .where('q."moduleId" IN (:...moduleIds)', { moduleIds })
      .andWhere('q."isSample" = true')
      // Draft samples are as unreviewed as draft questions, and this is the
      // first thing a candidate sees of the assessment.
      .andWhere('q.status = :status', { status: QuestionStatus.ACTIVE })
      .andWhere(QUESTION_VISIBLE_TO_ORG, { organisationId })
      .orderBy('module.name', 'ASC')
      // An organisation's own samples before the platform's, so a company that
      // has written practice questions for its own subject matter shows those
      // and the generic set steps aside. `NULLS LAST` on the owner id is what
      // does it: a platform question has none.
      .addOrderBy('q."organisationId"', 'ASC', 'NULLS LAST')
      .addOrderBy('q."createdAt"', 'ASC')
      .getMany();

    /*
     * Round-robin across the subjects, to `PRACTICE_TARGET` in total.
     *
     * One from each subject before a second from any of them, which gives the
     * breadth-first behaviour the target is chosen for: three subjects produce
     * a tour of all three, and one subject falls through to taking three from
     * it. A per-subject cap could do neither — it gave a single-subject
     * assessment exactly one question, which is what this replaced.
     *
     * The rows arrive already ordered by subject, then an organisation's own
     * samples before the platform's, so taking from the front of each queue
     * preserves both preferences.
     */
    const byModule = new Map<string, Question[]>();
    for (const question of rows) {
      const queue = byModule.get(question.moduleId);
      if (queue) queue.push(question);
      else byModule.set(question.moduleId, [question]);
    }

    const queues = [...byModule.values()];
    const picked: Question[] = [];

    while (
      picked.length < PRACTICE_TARGET &&
      queues.some((q) => q.length > 0)
    ) {
      for (const queue of queues) {
        if (picked.length >= PRACTICE_TARGET) break;
        const next = queue.shift();
        if (next) picked.push(next);
      }
    }

    const chosen: PracticeQuestion[] = [];

    for (const question of picked) {
      const objective = question.module.scoringType === ScoringType.OBJECTIVE;
      const options = objective
        ? (question.mcqDetails?.options ?? [])
        : (question.personalityDetails?.options ?? []);

      chosen.push({
        id: question.id,
        moduleName: question.module.name,
        scoringType: question.module.scoringType,
        text: question.questionText,
        // Narrowed to what the renderer needs. A personality option carries its
        // trait weights, and sending those would hand the candidate the scoring
        // key for a question type whose whole premise is that there is no key.
        options: options.map((option) => ({
          key: option.key,
          text: option.text,
        })),
        pattern: objective
          ? null
          : (question.personalityDetails?.pattern ?? null),
        correctOption: objective
          ? (question.mcqDetails?.correctOption ?? null)
          : null,
      });
    }

    return chosen;
  }
}
