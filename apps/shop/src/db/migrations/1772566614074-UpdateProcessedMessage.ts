import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateProcessedMessage1772566614074 implements MigrationInterface {
  name = 'UpdateProcessedMessage1772566614074';

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "processed_messages" DROP COLUMN "processed_at"`);
    await queryRunner.query(`ALTER TABLE "processed_messages" DROP COLUMN "order_id"`);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "processed_messages" ADD "order_id" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "processed_messages" ADD "processed_at" TIMESTAMP WITH TIME ZONE`,
    );
  }
}
