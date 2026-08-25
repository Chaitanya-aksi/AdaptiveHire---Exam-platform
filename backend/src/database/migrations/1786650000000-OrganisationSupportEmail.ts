import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Where a candidate turns when something goes wrong mid-assessment.
 *
 * The clock is server-authoritative and auto-submit fires whether or not the
 * browser is still open, which is right — it is what stops a candidate stopping
 * their own timer. But it means a power cut or a dropped connection can end an
 * attempt through no fault of the person sitting it, and until now they had
 * nowhere to say so: no address anywhere in the product, and the invitation
 * email comes from a platform they have never heard of.
 *
 * On the organisation rather than the platform, because the company that
 * invited them is the one that can actually do something about it. Null falls
 * back to whatever `SUPPORT_EMAIL` is configured, and if that is unset too the
 * UI shows nothing rather than a dead link.
 */
export class OrganisationSupportEmail1786650000000 implements MigrationInterface {
  name = 'OrganisationSupportEmail1786650000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organisations"
        ADD COLUMN "supportEmail" character varying(255)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organisations" DROP COLUMN "supportEmail"
    `);
  }
}
