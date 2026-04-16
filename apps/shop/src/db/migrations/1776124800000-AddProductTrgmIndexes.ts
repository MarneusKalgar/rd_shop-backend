import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductTrgmIndexes1776124800000 implements MigrationInterface {
  name = 'AddProductTrgmIndexes1776124800000';

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_products_description_trgm"');
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_products_title_trgm"');
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await queryRunner.query(
      'CREATE INDEX "IDX_products_title_trgm" ON "products" USING GIN ("title" gin_trgm_ops)',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_products_description_trgm" ON "products" USING GIN ("description" gin_trgm_ops)',
    );
  }
}
