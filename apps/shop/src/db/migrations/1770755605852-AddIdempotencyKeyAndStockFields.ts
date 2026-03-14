import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIdempotencyKeyAndStockFields1770755605852 implements MigrationInterface {
  name = 'AddIdempotencyKeyAndStockFields1770755605852';

  public async down(queryRunner: QueryRunner): Promise<void> {
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
      `ALTER TABLE "orders" DROP CONSTRAINT "UQ_59d6b7756aeb6cbb43a093d15a1"`,
    );
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "idempotency_key"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "stock"`);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" ADD "stock" integer NOT NULL DEFAULT '0'`);
    await queryRunner.query(`ALTER TABLE "orders" ADD "idempotency_key" character varying(255)`);
    await queryRunner.query(
      `ALTER TABLE "orders" ADD CONSTRAINT "UQ_59d6b7756aeb6cbb43a093d15a1" UNIQUE ("idempotency_key")`,
    );
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
  }
}
