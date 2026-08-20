import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Scheduled windows: when an assessment opens and when it closes.
 *
 * Campus and volume hiring runs on windows — "the aptitude round is Tuesday
 * 09:00 to Friday 17:00" — not on open-ended invitations. Until now an
 * invitation could be sat the moment it arrived and forever after, and the only
 * way to stop that was to revoke it one candidate at a time.
 *
 * Three columns, not four. `invitations.expiresAt` already existed and already
 * meant "this candidate's personal deadline", so it becomes the per-invitation
 * close and only the open time is new. The effective window for a candidate is
 * their own value where set, otherwise the assessment's — which is what makes
 * rescheduling one person possible without touching the round.
 *
 * All `timestamptz`, so what is stored is an instant rather than a wall-clock
 * reading. A window written by a recruiter in Bengaluru and read by a candidate
 * in Berlin has to mean the same moment, and a naive timestamp would not.
 */
export class AssessmentWindows1786630000000 implements MigrationInterface {
  name = 'AssessmentWindows1786630000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "assessments"
        ADD COLUMN "opensAt"  TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "closesAt" TIMESTAMP WITH TIME ZONE
    `);

    await queryRunner.query(`
      ALTER TABLE "invitations"
        ADD COLUMN "opensAt" TIMESTAMP WITH TIME ZONE
    `);

    // Null everywhere means "no window", which is exactly what every existing
    // assessment has today. Nothing that works now stops working.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "invitations" DROP COLUMN "opensAt"`);
    await queryRunner.query(`
      ALTER TABLE "assessments"
        DROP COLUMN "closesAt",
        DROP COLUMN "opensAt"
    `);
  }
}
