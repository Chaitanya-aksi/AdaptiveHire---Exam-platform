import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Introduces organisations, the tenancy boundary that makes open recruiter
 * registration safe.
 *
 * Until now recruiter accounts were seeded by hand, so every recruiter was a
 * trusted colleague and nothing was scoped: `createdById` and `invitedById` were
 * written on every row and never once appeared in a WHERE clause. That is fine
 * for three colleagues and a data breach the moment a stranger can sign up, so
 * this has to land together with self-registration, not after it.
 *
 * The backfill, in detail:
 *
 *   - One organisation is created for the existing recruiters, named after the
 *     platform itself. All current `recruiter_admin` accounts join it, so the
 *     people already using the system keep seeing exactly what they saw before.
 *   - Every existing assessment is assigned to it, for the same reason.
 *   - Candidates get no organisation, deliberately and permanently: a candidate
 *     is a person rather than a customer's record, and the same account sits
 *     assessments for whoever invites them.
 *   - Questions tagged `fixture` become platform questions (`organisationId`
 *     null) — that is the starter bank every new signup needs in order to build
 *     a working assessment on day one. Everything else stays with the default
 *     organisation so whoever authored it keeps the right to edit it. Promoting
 *     those to platform content later is a one-line UPDATE.
 *
 * `assessments.organisationId` is added nullable, backfilled, then made NOT
 * NULL — an assessment nobody owns is visible to nobody and scopeable by
 * nothing. `questions.organisationId` stays nullable because null is a real
 * value there, meaning "belongs to the platform".
 */
export class Organisations1786540000000 implements MigrationInterface {
  name = 'Organisations1786540000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "organisations" (
        "id"        uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name"      character varying(200) NOT NULL,
        "slug"      character varying(220) NOT NULL,
        "isActive"  boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_organisations" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_organisations_slug" ON "organisations" ("slug")`,
    );

    await queryRunner.query(`ALTER TABLE "users" ADD "organisationId" uuid`);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD CONSTRAINT "FK_users_organisation"
        FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(
      `ALTER TABLE "assessments" ADD "organisationId" uuid`,
    );
    await queryRunner.query(`ALTER TABLE "questions" ADD "organisationId" uuid`);
    await queryRunner.query(
      `CREATE INDEX "IDX_questions_organisation" ON "questions" ("organisationId")`,
    );

    // Only create the default organisation if there is anything to put in it, so
    // a fresh database does not start with a stray tenant.
    const [{ count }] = (await queryRunner.query(
      `SELECT COUNT(*)::int AS count FROM "users" WHERE role = 'recruiter_admin'`,
    )) as { count: number }[];

    if (count > 0) {
      const [{ id }] = (await queryRunner.query(
        `INSERT INTO "organisations" ("name", "slug") VALUES ($1, $2) RETURNING id`,
        ['AdaptiveHire', 'adaptivehire'],
      )) as { id: string }[];

      await queryRunner.query(
        `UPDATE "users" SET "organisationId" = $1 WHERE role = 'recruiter_admin'`,
        [id],
      );
      await queryRunner.query(
        `UPDATE "assessments" SET "organisationId" = $1`,
        [id],
      );
      // The synthetic engine-validation bank becomes the platform's starter
      // content; anything hand-authored stays editable by the people who wrote it.
      await queryRunner.query(
        `UPDATE "questions" SET "organisationId" = $1 WHERE NOT ('fixture' = ANY(tags))`,
        [id],
      );
    }

    await queryRunner.query(
      `ALTER TABLE "assessments" ALTER COLUMN "organisationId" SET NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "assessments"
        ADD CONSTRAINT "FK_assessments_organisation"
        FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "questions"
        ADD CONSTRAINT "FK_questions_organisation"
        FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "questions" DROP CONSTRAINT "FK_questions_organisation"`,
    );
    await queryRunner.query(
      `ALTER TABLE "assessments" DROP CONSTRAINT "FK_assessments_organisation"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "FK_users_organisation"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_questions_organisation"`);
    await queryRunner.query(
      `ALTER TABLE "questions" DROP COLUMN "organisationId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "assessments" DROP COLUMN "organisationId"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "organisationId"`);
    await queryRunner.query(`DROP INDEX "IDX_organisations_slug"`);
    await queryRunner.query(`DROP TABLE "organisations"`);
  }
}
