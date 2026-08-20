import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Who did what.
 *
 * Nothing recorded this before: invitations could be withdrawn, assessments and
 * candidate accounts deleted (with their sessions, responses and reports
 * cascading behind them), and candidate reports read, all without leaving a
 * trace. That is the first thing asked for in any security review, and adding
 * it later across dozens of endpoints costs far more than adding it now.
 *
 * `actorId` is `ON DELETE SET NULL` rather than `CASCADE` on purpose: the record
 * of an action has to outlive the account that took it, or deleting yourself
 * would erase your own trail.
 */
export class AuditLog1786590000000 implements MigrationInterface {
  name = 'AuditLog1786590000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "audit_log" (
        "id"             uuid NOT NULL DEFAULT gen_random_uuid(),
        "actorId"        uuid,
        "organisationId" uuid,
        "action"         character varying(160) NOT NULL,
        "resourceType"   character varying(60) NOT NULL,
        "resourceId"     uuid,
        "metadata"       jsonb,
        "occurredAt"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_log" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "audit_log"
        ADD CONSTRAINT "FK_audit_log_actor"
        FOREIGN KEY ("actorId") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    // "What did this person do", newest first.
    await queryRunner.query(`
      CREATE INDEX "IDX_audit_log_actor_time"
        ON "audit_log" ("actorId", "occurredAt")
    `);

    // "What happened to this thing".
    await queryRunner.query(`
      CREATE INDEX "IDX_audit_log_resource"
        ON "audit_log" ("resourceType", "resourceId")
    `);

    // Plain time ordering, and the key any future retention sweep will prune on.
    await queryRunner.query(`
      CREATE INDEX "IDX_audit_log_time" ON "audit_log" ("occurredAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_audit_log_time"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_audit_log_resource"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_audit_log_actor_time"`);
    await queryRunner.query(
      `ALTER TABLE "audit_log" DROP CONSTRAINT "FK_audit_log_actor"`,
    );
    await queryRunner.query(`DROP TABLE "audit_log"`);
  }
}
