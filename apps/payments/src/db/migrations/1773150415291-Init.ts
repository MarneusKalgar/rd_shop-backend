import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1773150415291 implements MigrationInterface {
  name = 'Init1773150415291';

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_payments_order_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_payments_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_payments_created_at"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b2f7b823a21562eeca20e72b00"`);
    await queryRunner.query(`DROP TABLE "payments"`);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "payments" ("amount" numeric(12,2) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "currency" character varying(3) NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "order_id" uuid NOT NULL, "payment_id" character varying(255) NOT NULL, "status" smallint NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_8866a3cfff96b8e17c2b204aae0" UNIQUE ("payment_id"), CONSTRAINT "PK_197ab7af18c93fbb0c9b28b4a59" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b2f7b823a21562eeca20e72b00" ON "payments" ("order_id") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_payments_created_at" ON "payments" ("created_at") `);
    await queryRunner.query(`CREATE INDEX "IDX_payments_status" ON "payments" ("status") `);
    await queryRunner.query(`CREATE INDEX "IDX_payments_order_id" ON "payments" ("order_id") `);
  }
}
