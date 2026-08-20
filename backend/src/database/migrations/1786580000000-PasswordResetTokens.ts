import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Self-service password reset.
 *
 * Until now the only ways back into an account were knowing the current
 * password or being re-provisioned by a recruiter — and a candidate whose
 * account was created by the invite flow has a `mustChangePassword` flag
 * blocking them from every assessment, so losing the emailed credentials meant
 * being locked out permanently with nobody able to help.
 *
 * Only the SHA-256 digest of each token is stored, so this table is useless to
 * anyone who reads it. `usedAt` is kept rather than the row deleted, so a token
 * presented a second time can be refused as spent instead of unknown.
 */
export class PasswordResetTokens1786580000000 implements MigrationInterface {
  name = 'PasswordResetTokens1786580000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "password_reset_tokens" (
        "id"        uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId"    uuid NOT NULL,
        "tokenHash" character varying(64) NOT NULL,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "usedAt"    TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_password_reset_tokens" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "password_reset_tokens"
        ADD CONSTRAINT "FK_password_reset_tokens_user"
        FOREIGN KEY ("userId") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    // Redemption looks the token up by digest, so this index is the read path
    // as well as the guarantee that two requests can never collide.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_password_reset_tokens_hash"
        ON "password_reset_tokens" ("tokenHash")
    `);

    // Issuing a new token invalidates the holder's outstanding ones, which is a
    // lookup by user.
    await queryRunner.query(`
      CREATE INDEX "IDX_password_reset_tokens_user"
        ON "password_reset_tokens" ("userId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_password_reset_tokens_user"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_password_reset_tokens_hash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "password_reset_tokens" DROP CONSTRAINT "FK_password_reset_tokens_user"`,
    );
    await queryRunner.query(`DROP TABLE "password_reset_tokens"`);
  }
}
