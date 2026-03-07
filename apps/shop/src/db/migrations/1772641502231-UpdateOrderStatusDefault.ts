import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateOrderStatusDefault1772641502231 implements MigrationInterface {
  name = 'UpdateOrderStatusDefault1772641502231';

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'CREATED'`);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'PENDING'`);
  }
}
