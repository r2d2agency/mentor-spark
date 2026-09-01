import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSalesPageSections1788192000000 implements MigrationInterface {
  name = 'AddSalesPageSections1788192000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sales_pages" ADD COLUMN IF NOT EXISTS "sections" jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sales_pages" DROP COLUMN IF EXISTS "sections"`);
  }
}
