import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A shareable link that lets a candidate reach an assessment without an emailed
 * invitation.
 *
 * **Why.** Invitation email has never been delivered from production: Render
 * blocks outbound SMTP on 25, 465 and 587 for free web services, and Zoho
 * refuses Render's shared outbound ranges for OAuth. Both were proved, not
 * guessed — see the probes in `.github/workflows/`. Every route around it needs
 * something outside our control: DNS in an account nobody can reach, a phone
 * number, a card, or an admin console we are not authorised for.
 *
 * So this removes email from the critical path rather than continuing to fix
 * it. See `docs/public-assessment-links.md` for the full proposal, including
 * what it deliberately gives up.
 *
 * **Everything here is nullable and inert when unset.** An assessment that
 * never enables a link behaves exactly as it did before, which is what makes
 * this safe to ship while a live cohort is mid-flight.
 */
export class PublicAssessmentLinks1786740000000 implements MigrationInterface {
  name = 'PublicAssessmentLinks1786740000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "assessments"
        ADD COLUMN "publicLinkTokenHash" character varying(64),
        ADD COLUMN "publicLinkEnabled"   boolean NOT NULL DEFAULT false,
        ADD COLUMN "publicLinkExpiresAt" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "publicLinkMaxAttempts" integer,
        ADD COLUMN "publicLinkEmailDomain" character varying(255)
    `);

    /*
     * The hash, never the token.
     *
     * The token is a credential: whoever holds it can start an attempt and see
     * questions from a bank we curate. Storing it in the clear would put a live
     * credential in every database backup and in the reach of any read-only
     * query, for no benefit — it is generated once, shown once, and only ever
     * compared against afterwards. Same reasoning as `password_reset_tokens`.
     *
     * Unique so a lookup by hash cannot ambiguously match two assessments.
     */
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_assessments_public_link"
        ON "assessments" ("publicLinkTokenHash")
        WHERE "publicLinkTokenHash" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."invitations_source_enum" AS ENUM('recruiter', 'self')
    `);

    /*
     * How this invitation came about, and the two signals recorded at entry.
     *
     * `source` defaults to 'recruiter' so every existing row is correct without
     * a backfill: everything created before today was created by a recruiter.
     *
     * The IP and user agent are **recorded and shown, never enforced**. Blocking
     * a repeat IP was considered and rejected: a college, an office or a
     * household shares one address, and Indian mobile carriers put thousands of
     * users behind carrier-grade NAT, so it would refuse legitimate candidates
     * in bulk while a VPN defeats it in seconds. Recording it lets a recruiter
     * notice a pattern and decide — the same rule the whole proctoring stack
     * runs on: detect and log for human judgment, never auto-disqualify.
     */
    await queryRunner.query(`
      ALTER TABLE "invitations"
        ADD COLUMN "source" "public"."invitations_source_enum"
          NOT NULL DEFAULT 'recruiter',
        ADD COLUMN "registeredIp" character varying(45),
        ADD COLUMN "registeredUserAgent" character varying(512)
    `);

    // The results page marks self-registered attempts, so it filters on this.
    await queryRunner.query(`
      CREATE INDEX "IDX_invitations_source" ON "invitations" ("source")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_invitations_source"`);
    await queryRunner.query(`
      ALTER TABLE "invitations"
        DROP COLUMN "registeredUserAgent",
        DROP COLUMN "registeredIp",
        DROP COLUMN "source"
    `);
    await queryRunner.query(`DROP TYPE "public"."invitations_source_enum"`);
    await queryRunner.query(`DROP INDEX "UQ_assessments_public_link"`);
    await queryRunner.query(`
      ALTER TABLE "assessments"
        DROP COLUMN "publicLinkEmailDomain",
        DROP COLUMN "publicLinkMaxAttempts",
        DROP COLUMN "publicLinkExpiresAt",
        DROP COLUMN "publicLinkEnabled",
        DROP COLUMN "publicLinkTokenHash"
    `);
  }
}
