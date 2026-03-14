import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPasswordToUsers1771791556519 implements MigrationInterface {
  name = 'AddPasswordToUsers1771791556519';

  public async down(queryRunner: QueryRunner): Promise<void> {
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
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "password"`);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "password" character varying(255)`);
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
  }
}
