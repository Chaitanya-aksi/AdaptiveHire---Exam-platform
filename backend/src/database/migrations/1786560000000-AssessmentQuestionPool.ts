import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets a recruiter choose which questions an assessment may draw from.
 *
 * The pool narrows the engine's choices without replacing them: it still selects
 * question by question on difficulty match and trait coverage, so the test stays
 * adaptive and two candidates still get different papers. A fixed ordered list
 * would have removed the adaptation entirely.
 *
 * **Absence of rows means no restriction.** An assessment with no pool entries
 * draws on everything visible to its organisation, which is both the sensible
 * default for a new assessment and what leaves every assessment created before
 * this migration working exactly as it did. Nothing is backfilled for that
 * reason — writing a row per question for each existing assessment would turn an
 * open pool into a frozen snapshot that silently stops including newly authored
 * questions.
 *
 * The composite primary key makes a duplicate entry impossible; the extra index
 * on `questionId` serves the reverse lookup ("which assessments use this
 * question?"), which the cascade on delete relies on.
 */
export class AssessmentQuestionPool1786560000000 implements MigrationInterface {
  name = 'AssessmentQuestionPool1786560000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "assessment_questions" (
        "assessmentId" uuid NOT NULL,
        "questionId"   uuid NOT NULL,
        CONSTRAINT "PK_assessment_questions" PRIMARY KEY ("assessmentId", "questionId")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "assessment_questions"
        ADD CONSTRAINT "FK_assessment_questions_assessment"
        FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "assessment_questions"
        ADD CONSTRAINT "FK_assessment_questions_question"
        FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_assessment_questions_question" ON "assessment_questions" ("questionId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_assessment_questions_question"`);
    await queryRunner.query(`DROP TABLE "assessment_questions"`);
  }
}
