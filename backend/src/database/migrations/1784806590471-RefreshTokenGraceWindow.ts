import { MigrationInterface, QueryRunner } from 'typeorm';

export class RefreshTokenGraceWindow1784806590471 implements MigrationInterface {
  name = 'RefreshTokenGraceWindow1784806590471';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "previousHashedRefreshToken" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "refreshTokenRotatedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "refreshTokenRotatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "previousHashedRefreshToken"`,
    );
  }
}
