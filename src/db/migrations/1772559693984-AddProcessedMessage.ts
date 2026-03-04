import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProcessedMessage1772559693984 implements MigrationInterface {
  name = 'AddProcessedMessage1772559693984';

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_processed_messages_message_id"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_processed_messages_idempotency_key"`);
    await queryRunner.query(`DROP TABLE "processed_messages"`);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "processed_messages" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "idempotency_key" character varying(255), "message_id" character varying(200) NOT NULL, "scope" character varying(100) NOT NULL, CONSTRAINT "PK_61d06681389f1e78ca233e08d55" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_processed_messages_idempotency_key" ON "processed_messages" ("idempotency_key") WHERE "idempotency_key" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_processed_messages_message_id" ON "processed_messages" ("message_id") `,
    );
  }
}
