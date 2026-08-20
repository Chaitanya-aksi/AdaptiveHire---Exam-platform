import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records that a candidate has been told they were not taken forward.
 *
 * Kept on the review row rather than inferred from the mail queue, which drops
 * its jobs on completion: "has this person already been told?" has to stay
 * answerable for as long as the decision itself, and sending a second rejection
 * is worse than sending none.
 *
 * Nullable with no default and no backfill — every existing review predates the
 * feature, so none of those candidates has been emailed, and null says exactly
 * that.
 */
export class RejectionEmailSentAt1786660000000 implements MigrationInterface {
  name = 'RejectionEmailSentAt1786660000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "candidate_reviews"
        ADD COLUMN "rejectionEmailSentAt" TIMESTAMP WITH TIME ZONE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "candidate_reviews" DROP COLUMN "rejectionEmailSentAt"
    `);
  }
}
