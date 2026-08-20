import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets a report carry no recommendation at all.
 *
 * `borderline` used to stand in whenever there was no score to band, which put
 * an attempt where nothing was answered in the same bucket as one that genuinely
 * scored in the middle. Those mean opposite things to a recruiter reading a
 * list, and only one of them is a finding.
 *
 * Existing rows are deliberately **not** backfilled. A stored `borderline` may
 * be either case and this migration cannot tell them apart; the reports are
 * regenerated from the answers on demand, so re-running one produces the right
 * value with evidence behind it rather than a guess made here.
 */
export class NullableRecommendation1786680000000 implements MigrationInterface {
  name = 'NullableRecommendation1786680000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "reports"
        ALTER COLUMN "hiringRecommendation" DROP NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Anything null has to become something before the constraint returns, and
    // `borderline` is what it would have been. This loses the distinction the
    // up-migration exists to create, which is the nature of reversing it.
    await queryRunner.query(`
      UPDATE "reports"
        SET "hiringRecommendation" = 'borderline'
        WHERE "hiringRecommendation" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "reports"
        ALTER COLUMN "hiringRecommendation" SET NOT NULL
    `);
  }
}
