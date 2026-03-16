import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderPaymentId1773165611938 implements MigrationInterface {
  name = 'AddOrderPaymentId1773165611938';

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "payment_id"`);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" ADD "payment_id" character varying(255)`);
    await queryRunner.query(
      `ALTER TABLE "orders" ADD CONSTRAINT "UQ_5b3e94bd2aedc184f9ad8c10439" UNIQUE ("payment_id")`,
    );
  }
}
