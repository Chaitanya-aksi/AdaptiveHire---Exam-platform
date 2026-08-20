import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two additions that arrive together because the pre-assessment flow needs both.
 *
 * `questions.isSample` marks a practice question: shown before the clock starts,
 * with its answer revealed, and excluded from the adaptive selector and from
 * every assessment pool. Default false, so nothing already in the bank changes
 * meaning.
 *
 * `background_noise` joins the proctoring event types. It is a widening of the
 * security scope that was locked in CLAUDE.md, made on explicit confirmation and
 * recorded there. The level is measured in the browser and discarded — no audio
 * is recorded, buffered or transmitted, so what reaches this database is the
 * same shape of fact as `face_absent`: that it happened, and when.
 */
export class SampleQuestionsAndAudioSignal1786690000000
  implements MigrationInterface
{
  name = 'SampleQuestionsAndAudioSignal1786690000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "questions"
        ADD COLUMN "isSample" boolean NOT NULL DEFAULT false
    `);

    // Partial: the selector's hot path asks for servable questions, and the
    // samples are the small minority. Indexing only them keeps it cheap.
    await queryRunner.query(`
      CREATE INDEX "IDX_questions_is_sample"
        ON "questions" ("isSample") WHERE "isSample" = true
    `);

    // Postgres enums grow with ADD VALUE. `IF NOT EXISTS` so a re-run on a
    // database that already has it is not an error.
    await queryRunner.query(`
      ALTER TYPE "proctoring_logs_eventtype_enum"
        ADD VALUE IF NOT EXISTS 'background_noise'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_questions_is_sample"`);
    await queryRunner.query(`ALTER TABLE "questions" DROP COLUMN "isSample"`);

    // Deliberately not removed. Postgres cannot drop a value from an enum
    // without rebuilding the type, and any row already logged with it would
    // have to be deleted or rewritten first — destroying real proctoring
    // history to reverse a schema change is the wrong trade. An unused enum
    // value costs nothing.
  }
}
