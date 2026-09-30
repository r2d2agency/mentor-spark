import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSalesPageDocument1788280000000 implements MigrationInterface {
  name = 'AddSalesPageDocument1788280000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sales_pages" ADD COLUMN IF NOT EXISTS "document" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_pages" ADD COLUMN IF NOT EXISTS "html" text`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sales_pages" DROP COLUMN IF EXISTS "html"`);
    await queryRunner.query(`ALTER TABLE "sales_pages" DROP COLUMN IF EXISTS "document"`);
  }
}
