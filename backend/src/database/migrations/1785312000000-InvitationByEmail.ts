import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Invitations become email-keyed so a recruiter can invite someone who has no
 * account yet. `email` is added and backfilled from the linked user (a no-op
 * on a fresh DB), `candidateId` becomes nullable so a pending invite needs no
 * user row, and the natural key moves from (assessmentId, candidateId) to
 * (assessmentId, email).
 */
export class InvitationByEmail1785312000000 implements MigrationInterface {
  name = 'InvitationByEmail1785312000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add nullable first so existing rows (if any) don't violate NOT NULL.
    await queryRunner.query(
      `ALTER TABLE "invitations" ADD "email" character varying(255)`,
    );
    // Backfill from the currently-linked user, lowercased to match how users
    // are stored. No-op when there are no invitations yet.
    await queryRunner.query(
      `UPDATE "invitations" SET "email" = lower(u."email") FROM "users" u WHERE u."id" = "invitations"."candidateId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invitations" ALTER COLUMN "email" SET NOT NULL`,
    );

    // Old natural key was (assessmentId, candidateId); it can't survive
    // candidateId going nullable, and email is the stable key now.
    await queryRunner.query(
      `ALTER TABLE "invitations" DROP CONSTRAINT "UQ_de4b11f2e505d43d1fb946fe2fa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invitations" ALTER COLUMN "candidateId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "invitations" ADD CONSTRAINT "UQ_invitations_assessment_email" UNIQUE ("assessmentId", "email")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_invitations_email" ON "invitations" ("email")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_invitations_email"`);
    await queryRunner.query(
      `ALTER TABLE "invitations" DROP CONSTRAINT "UQ_invitations_assessment_email"`,
    );
    // Rows without a candidate can't be re-keyed on candidateId; drop them so
    // the NOT NULL + unique constraints can be restored.
    await queryRunner.query(
      `DELETE FROM "invitations" WHERE "candidateId" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "invitations" ALTER COLUMN "candidateId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "invitations" ADD CONSTRAINT "UQ_de4b11f2e505d43d1fb946fe2fa" UNIQUE ("assessmentId", "candidateId")`,
    );
    await queryRunner.query(`ALTER TABLE "invitations" DROP COLUMN "email"`);
  }
}
