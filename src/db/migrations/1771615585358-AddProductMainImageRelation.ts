import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductMainImageRelation1771615585358 implements MigrationInterface {
  name = 'AddProductMainImageRelation1771615585358';

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT "FK_8984eaad3b517d30bbdf01d8057"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_products_main_image_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_orders_status_created"`);
    await queryRunner.query(
      `CREATE TYPE "public"."file_records_visibility_enum_old" AS ENUM('PRIVATE', 'PUBLIC')`,
    );
    await queryRunner.query(`ALTER TABLE "file_records" ALTER COLUMN "visibility" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "file_records" ALTER COLUMN "visibility" TYPE "public"."file_records_visibility_enum_old" USING "visibility"::"text"::"public"."file_records_visibility_enum_old"`,
    );
    await queryRunner.query(
      `ALTER TABLE "file_records" ALTER COLUMN "visibility" SET DEFAULT 'PRIVATE'`,
    );
    await queryRunner.query(`DROP TYPE "public"."file_records_visibility_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."file_records_visibility_enum_old" RENAME TO "file_records_visibility_enum"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."file_records_status_enum_old" AS ENUM('PENDING', 'READY')`,
    );
    await queryRunner.query(`ALTER TABLE "file_records" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "file_records" ALTER COLUMN "status" TYPE "public"."file_records_status_enum_old" USING "status"::"text"::"public"."file_records_status_enum_old"`,
    );
    await queryRunner.query(
      `ALTER TABLE "file_records" ALTER COLUMN "status" SET DEFAULT 'PENDING'`,
    );
    await queryRunner.query(`DROP TYPE "public"."file_records_status_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."file_records_status_enum_old" RENAME TO "file_records_status_enum"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."orders_status_enum_old" AS ENUM('CANCELLED', 'CREATED', 'PAID')`,
    );
    await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "orders" ALTER COLUMN "status" TYPE "public"."orders_status_enum_old" USING "status"::"text"::"public"."orders_status_enum_old"`,
    );
    await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'CREATED'`);
    await queryRunner.query(`DROP TYPE "public"."orders_status_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."orders_status_enum_old" RENAME TO "orders_status_enum"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_orders_status_created" ON "orders" ("created_at", "status") `,
    );
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "main_image_id"`);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" ADD "main_image_id" uuid`);
    await queryRunner.query(`DROP INDEX "public"."IDX_orders_status_created"`);
    await queryRunner.query(
      `ALTER TYPE "public"."orders_status_enum" RENAME TO "orders_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."orders_status_enum" AS ENUM('CANCELLED', 'CREATED', 'PAID')`,
    );
    await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "orders" ALTER COLUMN "status" TYPE "public"."orders_status_enum" USING "status"::"text"::"public"."orders_status_enum"`,
    );
    await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'CREATED'`);
    await queryRunner.query(`DROP TYPE "public"."orders_status_enum_old"`);
    await queryRunner.query(
      `ALTER TYPE "public"."file_records_status_enum" RENAME TO "file_records_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."file_records_status_enum" AS ENUM('PENDING', 'READY')`,
    );
    await queryRunner.query(`ALTER TABLE "file_records" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "file_records" ALTER COLUMN "status" TYPE "public"."file_records_status_enum" USING "status"::"text"::"public"."file_records_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "file_records" ALTER COLUMN "status" SET DEFAULT 'PENDING'`,
    );
    await queryRunner.query(`DROP TYPE "public"."file_records_status_enum_old"`);
    await queryRunner.query(
      `ALTER TYPE "public"."file_records_visibility_enum" RENAME TO "file_records_visibility_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."file_records_visibility_enum" AS ENUM('PRIVATE', 'PUBLIC')`,
    );
    await queryRunner.query(`ALTER TABLE "file_records" ALTER COLUMN "visibility" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "file_records" ALTER COLUMN "visibility" TYPE "public"."file_records_visibility_enum" USING "visibility"::"text"::"public"."file_records_visibility_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "file_records" ALTER COLUMN "visibility" SET DEFAULT 'PRIVATE'`,
    );
    await queryRunner.query(`DROP TYPE "public"."file_records_visibility_enum_old"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_orders_status_created" ON "orders" ("status", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_products_main_image_id" ON "products" ("main_image_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD CONSTRAINT "FK_8984eaad3b517d30bbdf01d8057" FOREIGN KEY ("main_image_id") REFERENCES "file_records"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }
}
