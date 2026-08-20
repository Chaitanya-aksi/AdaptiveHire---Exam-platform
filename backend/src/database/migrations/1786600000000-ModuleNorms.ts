import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Score distributions, so an ability estimate can be reported as a percentile.
 *
 * A bare Elo number is unreadable to the person it is written for: a recruiter
 * seeing "1180" cannot tell whether that is good. This table holds the 99
 * percentile thresholds per module, rebuilt nightly from
 * `session_module_results`, which turns that number into "78th percentile of
 * 4,200 candidates".
 *
 * One row per module, replaced wholesale on each recompute — hence the module
 * id as the primary key rather than a surrogate with a uniqueness constraint
 * bolted on.
 */
export class ModuleNorms1786600000000 implements MigrationInterface {
  name = 'ModuleNorms1786600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "module_norms" (
        "moduleId"   uuid NOT NULL,
        "thresholds" jsonb NOT NULL,
        "sampleSize" integer NOT NULL,
        "computedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_module_norms" PRIMARY KEY ("moduleId")
      )
    `);

    // Retiring a module takes its distribution with it; a norm for a module
    // that no longer exists could never be read and would never be rebuilt.
    await queryRunner.query(`
      ALTER TABLE "module_norms"
        ADD CONSTRAINT "FK_module_norms_module"
        FOREIGN KEY ("moduleId") REFERENCES "modules"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "module_norms" DROP CONSTRAINT "FK_module_norms_module"`,
    );
    await queryRunner.query(`DROP TABLE "module_norms"`);
  }
}
