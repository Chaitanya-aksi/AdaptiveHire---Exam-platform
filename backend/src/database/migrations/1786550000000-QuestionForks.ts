import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets an organisation change a platform question without changing it for
 * everybody.
 *
 * Platform questions are shared: one customer rewording or archiving one that
 * another customer's live assessment depends on is exactly what tenancy exists to
 * prevent. But refusing the edit outright leaves a recruiter stuck with starter
 * content they may not want. So editing a platform question now takes a private
 * copy — a fork — carrying `forkedFromId`, and that organisation sees its own
 * version in place of the original while every other organisation keeps the
 * pristine one.
 *
 * Hiding uses the same mechanism: a fork with `status = 'archived'` disappears
 * from that organisation's bank and is never served to its candidates, and
 * nobody else is affected. Deleting a fork reverts the organisation to the
 * platform version, because with the fork gone the original becomes visible
 * again.
 *
 * `ON DELETE SET NULL` rather than CASCADE: if a platform question is ever
 * deleted, an organisation keeps the copy it edited — losing their authoring
 * because the upstream original went away would be the wrong trade. The fork
 * simply becomes an ordinary question of theirs.
 *
 * The unique index is partial so it constrains only forks: one per organisation
 * per platform question, which is what makes "my version of that question"
 * unambiguous. Ordinary questions all have a null `forkedFromId` and are not
 * constrained by it.
 */
export class QuestionForks1786550000000 implements MigrationInterface {
  name = 'QuestionForks1786550000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "questions" ADD "forkedFromId" uuid`,
    );
    await queryRunner.query(`
      ALTER TABLE "questions"
        ADD CONSTRAINT "FK_questions_forked_from"
        FOREIGN KEY ("forkedFromId") REFERENCES "questions"("id") ON DELETE SET NULL
    `);
    // Drives the NOT EXISTS in the visibility rule, which runs on every question
    // the engine considers serving.
    await queryRunner.query(
      `CREATE INDEX "IDX_questions_forked_from" ON "questions" ("forkedFromId")`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_questions_fork_per_org"
        ON "questions" ("organisationId", "forkedFromId")
        WHERE "forkedFromId" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_questions_fork_per_org"`);
    await queryRunner.query(`DROP INDEX "IDX_questions_forked_from"`);
    await queryRunner.query(
      `ALTER TABLE "questions" DROP CONSTRAINT "FK_questions_forked_from"`,
    );
    await queryRunner.query(
      `ALTER TABLE "questions" DROP COLUMN "forkedFromId"`,
    );
  }
}
