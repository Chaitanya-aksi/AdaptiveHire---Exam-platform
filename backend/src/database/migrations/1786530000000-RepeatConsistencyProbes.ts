import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds repeat probes: pairs of questions that measure the same thing in
 * different clothing, served far apart in one module.
 *
 * `questions.probeGroup` twins them. Two questions sharing a group are the same
 * underlying construct with a reworded stem and reworded, reordered options, so
 * a candidate meeting the second one does not recognise it as the first. The
 * engine holds the twin back until eight questions have passed, then compares
 * the two answers — which is the only way to tell an answer someone would give
 * again from one they happened to give.
 *
 * `session_module_results.probeResults` stores the outcome per module: which
 * pairs were served, both answers, and how closely they agreed. Nullable and
 * left null for every existing row, because those attempts had no probes — a
 * zero there would read as total disagreement on a measurement never taken.
 *
 * The column is indexed because the selector filters on it for every question it
 * serves, once to hold back groups that are mid-gap and once to find a twin that
 * has come due.
 */
export class RepeatConsistencyProbes1786530000000 implements MigrationInterface {
  name = 'RepeatConsistencyProbes1786530000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "questions" ADD "probeGroup" character varying(80)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_questions_probe_group" ON "questions" ("probeGroup")`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_module_results" ADD "probeResults" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "session_module_results" DROP COLUMN "probeResults"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_questions_probe_group"`);
    await queryRunner.query(`ALTER TABLE "questions" DROP COLUMN "probeGroup"`);
  }
}
