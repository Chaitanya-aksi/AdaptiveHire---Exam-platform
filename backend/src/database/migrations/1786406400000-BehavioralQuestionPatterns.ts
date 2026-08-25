import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Schema for the behavioural assessment engine.
 *
 * Two additions, both nullable so every existing row stays valid:
 *
 * `personality_question_details.pattern` — which of the four behavioural
 * shapes a question uses. Null means a legacy agree/disagree Likert item,
 * which is why the column is nullable rather than defaulted: the 40 questions
 * that predate this engine are not situational judgement questions and
 * labelling them as such would misrepresent them in the report.
 *
 * `responses.selectedOptions` — the candidate's ordering for a ranking
 * question. A ranking answer has no single chosen key, so `selectedOption`
 * stays null for those and the order is the answer.
 *
 * Deliberately no data changes here. Swapping the Personality module's trait
 * vocabulary and rewriting the legacy questions' weights is a separate,
 * reviewable migration.
 */
export class BehavioralQuestionPatterns1786406400000 implements MigrationInterface {
  name = 'BehavioralQuestionPatterns1786406400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."personality_question_details_pattern_enum" AS ENUM('situational', 'forced_choice', 'trade_off', 'ranking')`,
    );
    await queryRunner.query(
      `ALTER TABLE "personality_question_details" ADD "pattern" "public"."personality_question_details_pattern_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "responses" ADD "selectedOptions" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "responses" DROP COLUMN "selectedOptions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "personality_question_details" DROP COLUMN "pattern"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."personality_question_details_pattern_enum"`,
    );
  }
}
