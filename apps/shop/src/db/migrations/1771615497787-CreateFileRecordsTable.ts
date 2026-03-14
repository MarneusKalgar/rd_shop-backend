import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFileRecordsTable1771615497787 implements MigrationInterface {
  name = 'CreateFileRecordsTable1771615497787';

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "file_records" DROP CONSTRAINT "FK_ddc1eed561fb658b8324c87a5d9"`,
    );
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
    await queryRunner.query(`DROP INDEX "public"."IDX_file_records_owner_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_file_records_entity_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_file_records_object_key"`);
    await queryRunner.query(`DROP TABLE "file_records"`);
    await queryRunner.query(`DROP TYPE "public"."file_records_visibility_enum"`);
    await queryRunner.query(`DROP TYPE "public"."file_records_status_enum"`);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."file_records_status_enum" AS ENUM('PENDING', 'READY')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."file_records_visibility_enum" AS ENUM('PRIVATE', 'PUBLIC')`,
    );
    await queryRunner.query(
      `CREATE TABLE "file_records" ("bucket" character varying(120) NOT NULL, "completed_at" TIMESTAMP WITH TIME ZONE, "content_type" character varying(255) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "entity_id" uuid, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "key" character varying(500) NOT NULL, "owner_id" uuid NOT NULL, "size" bigint NOT NULL, "status" "public"."file_records_status_enum" NOT NULL DEFAULT 'PENDING', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "visibility" "public"."file_records_visibility_enum" NOT NULL DEFAULT 'PRIVATE', CONSTRAINT "PK_17d6bda4e953aace5de8a299e34" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_file_records_object_key" ON "file_records" ("key") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_file_records_entity_id" ON "file_records" ("entity_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_file_records_owner_id" ON "file_records" ("owner_id") `,
    );
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
      `ALTER TABLE "file_records" ADD CONSTRAINT "FK_ddc1eed561fb658b8324c87a5d9" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
