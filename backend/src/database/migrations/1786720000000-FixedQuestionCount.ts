import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Replaces `minQuestions` / `maxQuestions` with a single `questionCount`.
 *
 * The pair existed to give the stopping engine a range: end the module once
 * confidence is reached, but never before the minimum and never past the
 * maximum. That produced a deliberately variable length — two candidates sat
 * the same section and answered a different number of questions.
 *
 * Removing it is a product decision (2026-08-24), and the consequence is worth
 * recording rather than discovering later: **the test is no longer variable in
 * length.** It is still adaptive in *difficulty* — the selector still matches
 * each question to the running ability estimate, and the estimator still
 * updates after every answer — so this becomes fixed-length adaptive testing,
 * which is a normal design and makes two candidates' results directly
 * comparable on the same number of items. What is gone is the early
 * `confidence_reached` stop.
 *
 * Backfilled from `maxQuestions`, not the minimum or an average: the maximum is
 * what a section was already allowed to ask, so every existing assessment keeps
 * the longest shape it could previously have taken and nobody's configured
 * section silently gets shorter.
 */
export class FixedQuestionCount1786720000000 implements MigrationInterface {
  name = 'FixedQuestionCount1786720000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "assessment_modules"
        ADD COLUMN "questionCount" integer
    `);

    await queryRunner.query(`
      UPDATE "assessment_modules" SET "questionCount" = "maxQuestions"
    `);

    await queryRunner.query(`
      ALTER TABLE "assessment_modules"
        ALTER COLUMN "questionCount" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "assessment_modules"
        DROP COLUMN "minQuestions",
        DROP COLUMN "maxQuestions"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "assessment_modules"
        ADD COLUMN "minQuestions" integer,
        ADD COLUMN "maxQuestions" integer
    `);

    // The range this came from cannot be recovered — one number does not carry
    // two. Both edges become the fixed count, which is the only reading that
    // keeps every existing assessment behaving exactly as it does now.
    await queryRunner.query(`
      UPDATE "assessment_modules"
        SET "minQuestions" = "questionCount", "maxQuestions" = "questionCount"
    `);

    await queryRunner.query(`
      ALTER TABLE "assessment_modules"
        ALTER COLUMN "minQuestions" SET NOT NULL,
        ALTER COLUMN "maxQuestions" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "assessment_modules" DROP COLUMN "questionCount"
    `);
  }
}
