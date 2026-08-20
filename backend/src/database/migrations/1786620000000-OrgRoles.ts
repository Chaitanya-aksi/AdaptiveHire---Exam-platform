import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roles inside an organisation.
 *
 * Until now every member of a workspace was a `recruiter_admin` and could do
 * everything — delete any assessment, read any candidate's report, remove any
 * colleague. That is fine for one person and wrong for a team.
 *
 * `role` is untouched: it still says which side of the platform an account is
 * on, which is what portal separation, the route guards and the code-split
 * bundles all key off. This adds a second axis for what a recruiter may do
 * once inside their workspace.
 *
 * **The backfill deliberately grants, never restricts.** Everyone in an
 * existing workspace can already do everything, so demoting anyone here would
 * silently take away access people are using today. The earliest member of each
 * organisation becomes its Owner — they registered it — and everyone else
 * becomes an Admin, which preserves exactly what they had. Narrowing anybody to
 * Hiring Manager or Viewer is a decision for the team, made in the UI.
 */
export class OrgRoles1786620000000 implements MigrationInterface {
  name = 'OrgRoles1786620000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."users_orgrole_enum"
        AS ENUM('viewer', 'hiring_manager', 'admin', 'owner')
    `);

    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN "orgRole" "public"."users_orgrole_enum"
    `);

    // The first member of each organisation — the one whose registration
    // created it — becomes its Owner.
    await queryRunner.query(`
      UPDATE "users" u
         SET "orgRole" = 'owner'
       WHERE u."organisationId" IS NOT NULL
         AND u.id = (
           SELECT m.id
             FROM "users" m
            WHERE m."organisationId" = u."organisationId"
            ORDER BY m."createdAt" ASC, m.id ASC
            LIMIT 1
         )
    `);

    // Everyone else keeps what they effectively had already.
    await queryRunner.query(`
      UPDATE "users"
         SET "orgRole" = 'admin'
       WHERE "organisationId" IS NOT NULL
         AND "orgRole" IS NULL
    `);

    // Candidates belong to no organisation and stay null, permanently.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "orgRole"`);
    await queryRunner.query(`DROP TYPE "public"."users_orgrole_enum"`);
  }
}
