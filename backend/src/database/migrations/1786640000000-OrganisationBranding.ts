import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-organisation branding on the candidate-facing surfaces.
 *
 * A candidate sitting a test for Acme currently sees AdaptiveHire throughout,
 * and the invitation arrives from AdaptiveHire rather than from the company
 * they applied to. That reads as a third party they have never heard of asking
 * them to log in, which is both worse for the candidate and the first thing
 * every B2B customer asks about.
 *
 * Deliberately two columns rather than a theming system. The scope is a logo
 * and an accent — enough to make the page recognisably the customer's — and a
 * full white-label (custom domains, fonts, email templates per org) is a
 * different feature that should be decided on its own merits.
 */
export class OrganisationBranding1786640000000 implements MigrationInterface {
  name = 'OrganisationBranding1786640000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organisations"
        ADD COLUMN "logoUrl"     character varying(2048),
        ADD COLUMN "accentColor" character varying(7)
    `);

    // Null on both means "use AdaptiveHire's own", which is what every existing
    // organisation gets and what the UI falls back to.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organisations"
        DROP COLUMN "accentColor",
        DROP COLUMN "logoUrl"
    `);
  }
}
