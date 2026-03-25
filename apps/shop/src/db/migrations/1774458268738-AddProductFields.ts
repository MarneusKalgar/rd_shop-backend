import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductFields1774458268738 implements MigrationInterface {
  name = 'AddProductFields1774458268738';

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_products_price"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "description"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "deleted_at"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "country"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "category"`);
    await queryRunner.query(`DROP TYPE "public"."products_category_enum"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "brand"`);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" ADD "brand" character varying(100)`);
    await queryRunner.query(
      `CREATE TYPE "public"."products_category_enum" AS ENUM('accessories', 'audio', 'cameras', 'laptops', 'monitors', 'other', 'peripherals', 'smartphones', 'storage', 'tablets', 'wearables')`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD "category" "public"."products_category_enum" NOT NULL DEFAULT 'other'`,
    );
    await queryRunner.query(`ALTER TABLE "products" ADD "country" character varying(2)`);
    await queryRunner.query(`ALTER TABLE "products" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "products" ADD "description" text`);
    await queryRunner.query(`CREATE INDEX "IDX_products_price" ON "products" ("price") `);
  }
}
