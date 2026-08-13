import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Splits a report's headline figure into the two halves it is now blended from.
 *
 * Before this, `overallScore` was the mean of the objective modules and a
 * personality-only assessment scored null — which read as "this candidate has
 * no result" when in fact ten traits had been measured. It is now the blend of
 * an ability score and a behavioural index, and those two are stored alongside
 * it so the attempts list can show which half a figure came from.
 *
 * Existing rows are backfilled by copying `overallScore` into `abilityScore`:
 * for every report written before this migration that is exactly what the
 * number was. `behavioralScore` stays null, because it was never computed —
 * and a null there keeps the stored `overallScore` consistent with the new
 * blend, which gives a missing half no weight. Reports regenerate on demand,
 * so a recruiter opening an old attempt gets the composites then.
 */
export class BehavioralCompositeScores1786520000000
  implements MigrationInterface
{
  name = 'BehavioralCompositeScores1786520000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reports" ADD "abilityScore" numeric(5,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" ADD "behavioralScore" numeric(5,2)`,
    );
    await queryRunner.query(
      `UPDATE "reports" SET "abilityScore" = "overallScore" WHERE "overallScore" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // `overallScore` is left as it stands. Recomputing an ability-only value
    // from a blended one is not possible without the behavioural half, and
    // overwriting it with `abilityScore` would silently discard the behavioural
    // measurement from any report generated since this migration ran.
    await queryRunner.query(
      `ALTER TABLE "reports" DROP COLUMN "behavioralScore"`,
    );
    await queryRunner.query(`ALTER TABLE "reports" DROP COLUMN "abilityScore"`);
  }
}
