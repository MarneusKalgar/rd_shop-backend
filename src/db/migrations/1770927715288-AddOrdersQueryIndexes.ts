import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrdersQueryIndexes1770927715288 implements MigrationInterface {
  name = 'AddOrdersQueryIndexes1770927715288';

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_order_items_order_product"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_orders_status_created"`);
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
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
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
      `CREATE INDEX "IDX_orders_status_created" ON "orders" ("status", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_order_items_order_product" ON "order_items" ("order_id", "product_id") `,
    );
  }
}
