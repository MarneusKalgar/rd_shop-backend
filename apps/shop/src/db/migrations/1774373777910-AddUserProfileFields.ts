import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserProfileFields1774373777910 implements MigrationInterface {
  name = 'AddUserProfileFields1774373777910';

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_c3401836efedec3bec459c8f818"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "postcode"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "phone"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "last_name"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "first_name"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "deleted_at"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "country"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "city"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "avatar_id"`);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "avatar_id" uuid`);
    await queryRunner.query(`ALTER TABLE "users" ADD "city" character varying(100)`);
    await queryRunner.query(`ALTER TABLE "users" ADD "country" character varying(2)`);
    await queryRunner.query(`ALTER TABLE "users" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "users" ADD "first_name" character varying(50)`);
    await queryRunner.query(`ALTER TABLE "users" ADD "last_name" character varying(50)`);
    await queryRunner.query(`ALTER TABLE "users" ADD "phone" character varying(20)`);
    await queryRunner.query(`ALTER TABLE "users" ADD "postcode" character varying(20)`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_c3401836efedec3bec459c8f818" FOREIGN KEY ("avatar_id") REFERENCES "file_records"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }
}
