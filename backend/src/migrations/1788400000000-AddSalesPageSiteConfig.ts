import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSalesPageSiteConfig1788400000000 implements MigrationInterface {
  name = 'AddSalesPageSiteConfig1788400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sales_pages" ADD COLUMN IF NOT EXISTS "siteConfig" jsonb`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sales_pages" DROP COLUMN IF EXISTS "siteConfig"`);
  }
}
