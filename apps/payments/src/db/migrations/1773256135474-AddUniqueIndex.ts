import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUniqueIndex1773256135474 implements MigrationInterface {
  name = 'AddUniqueIndex1773256135474';

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_payments_order_id"`);
    await queryRunner.query(`CREATE INDEX "IDX_payments_order_id" ON "payments" ("order_id") `);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_payments_order_id"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_payments_order_id" ON "payments" ("order_id") `,
    );
  }
}
