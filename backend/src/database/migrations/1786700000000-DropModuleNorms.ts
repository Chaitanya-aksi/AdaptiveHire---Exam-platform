import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Retires the platform-wide score distributions.
 *
 * Percentiles were how a raw Elo estimate was made readable: "1180" means
 * nothing, "78th percentile" is a hiring signal. The problem was the cohort
 * behind it. `module_norms` pooled every organisation's attempts at a module,
 * so a recruiter was shown a rank against strangers they could not see, could
 * not reproduce, and could not act on — and a module with fewer than twenty
 * attempts platform-wide reported nothing at all, which read as a bug rather
 * than as a floor.
 *
 * Standing is now a plain rank within the one assessment being looked at,
 * computed live in `ReportsService.rankByScore` from the attempts already on
 * screen. Nothing needs storing for it, so the table and the nightly recompute
 * that filled it both go.
 *
 * **No data is lost.** Every row here was derived — an aggregate over
 * `session_module_results.abilityScore`, which is untouched. The `down`
 * migration rebuilds the empty table; a recompute job would refill it from
 * source, exactly as the nightly one always did.
 */
export class DropModuleNorms1786700000000 implements MigrationInterface {
  name = 'DropModuleNorms1786700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The FK goes with the table; naming it explicitly first keeps this
    // readable as the exact reverse of the migration that created it.
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "module_norms"
        DROP CONSTRAINT IF EXISTS "FK_module_norms_module"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "module_norms"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "module_norms" (
        "moduleId"   uuid NOT NULL,
        "thresholds" jsonb NOT NULL,
        "sampleSize" integer NOT NULL,
        "computedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_module_norms" PRIMARY KEY ("moduleId")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "module_norms"
        ADD CONSTRAINT "FK_module_norms_module"
        FOREIGN KEY ("moduleId") REFERENCES "modules"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }
}
