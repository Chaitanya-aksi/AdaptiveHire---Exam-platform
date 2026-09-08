import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-company branding for customers whose workspace covers a group of
 * businesses.
 *
 * The organisation stays the tenancy boundary and the account. What it stops
 * being is the only thing a candidate can be shown: a group with six
 * subsidiaries now stores six companies, and each assessment names the one the
 * candidate is actually appearing for.
 *
 * `assessments.companyId` is nullable and null is the pre-existing behaviour —
 * every assessment created before this migration keeps showing the
 * organisation's own branding, and a customer who is a single company never has
 * to think about the feature at all.
 */
export class GroupCompanies1786730000000 implements MigrationInterface {
  name = 'GroupCompanies1786730000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "companies" (
        "id"             uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organisationId" uuid NOT NULL,
        "name"           character varying(200) NOT NULL,
        "logoUrl"        character varying(2048),
        "accentColor"    character varying(7),
        "supportEmail"   character varying(255),
        "isActive"       boolean NOT NULL DEFAULT true,
        "createdAt"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_companies" PRIMARY KEY ("id"),
        CONSTRAINT "FK_companies_organisation"
          FOREIGN KEY ("organisationId") REFERENCES "organisations"("id")
          ON DELETE CASCADE
      )
    `);

    // The picker's own query: one organisation's active companies.
    await queryRunner.query(`
      CREATE INDEX "IDX_companies_org_active"
        ON "companies" ("organisationId", "isActive")
    `);

    /*
     * One name per workspace, case-insensitively.
     *
     * A dropdown holding "KhetPilot" twice is unusable — the recruiter cannot
     * tell which is which, and picking the wrong one puts the wrong logo in
     * front of a candidate. Scoped to the organisation, because two different
     * customers may both have a subsidiary of the same name and neither can see
     * the other's.
     */
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_companies_org_name"
        ON "companies" ("organisationId", lower("name"))
    `);

    await queryRunner.query(`
      ALTER TABLE "assessments"
        ADD COLUMN "companyId" uuid
    `);

    /*
     * SET NULL rather than CASCADE or RESTRICT, and the choice matters.
     *
     * CASCADE would delete a company's assessments — and their sessions,
     * responses and reports — because somebody tidied up a dropdown. RESTRICT
     * would refuse the delete and leave no way to remove a company at all
     * without first unpicking every round it was ever used for. SET NULL falls
     * back to the organisation's own branding, which is exactly what an
     * assessment with no company shows anyway.
     *
     * Retiring a company (`isActive = false`) is the intended route regardless:
     * it takes the company out of the picker while leaving every finished
     * attempt still naming the business the candidate actually applied to.
     */
    await queryRunner.query(`
      ALTER TABLE "assessments"
        ADD CONSTRAINT "FK_assessments_company"
          FOREIGN KEY ("companyId") REFERENCES "companies"("id")
          ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_assessments_company" ON "assessments" ("companyId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_assessments_company"`);
    await queryRunner.query(`
      ALTER TABLE "assessments" DROP CONSTRAINT "FK_assessments_company"
    `);
    await queryRunner.query(`ALTER TABLE "assessments" DROP COLUMN "companyId"`);
    await queryRunner.query(`DROP INDEX "UQ_companies_org_name"`);
    await queryRunner.query(`DROP INDEX "IDX_companies_org_active"`);
    await queryRunner.query(`DROP TABLE "companies"`);
  }
}
