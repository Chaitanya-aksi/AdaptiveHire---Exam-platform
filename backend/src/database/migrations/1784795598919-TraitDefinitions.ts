import { MigrationInterface, QueryRunner } from 'typeorm';

export class TraitDefinitions1784795598919 implements MigrationInterface {
  name = 'TraitDefinitions1784795598919';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "modules" DROP COLUMN "traits"`);
    await queryRunner.query(`ALTER TABLE "modules" ADD "traits" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "modules" DROP COLUMN "traits"`);
    await queryRunner.query(`ALTER TABLE "modules" ADD "traits" text array`);
  }
}
