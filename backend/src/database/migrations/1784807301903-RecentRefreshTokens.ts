import { MigrationInterface, QueryRunner } from 'typeorm';

export class RecentRefreshTokens1784807301903 implements MigrationInterface {
  name = 'RecentRefreshTokens1784807301903';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "previousHashedRefreshToken"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "refreshTokenRotatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "recentRefreshTokens" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "recentRefreshTokens"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "refreshTokenRotatedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "previousHashedRefreshToken" character varying(255)`,
    );
  }
}
