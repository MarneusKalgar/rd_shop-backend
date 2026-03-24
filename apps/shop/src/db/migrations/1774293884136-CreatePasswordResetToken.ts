import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePasswordResetToken1774293884136 implements MigrationInterface {
  name = 'CreatePasswordResetToken1774293884136';

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "password_reset_tokens" DROP CONSTRAINT "FK_52ac39dd8a28730c63aeb428c9c"`,
    );
    await queryRunner.query(`DROP TABLE "password_reset_tokens"`);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "password_reset_tokens" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "token_hash" character varying(255) NOT NULL, "used_at" TIMESTAMP WITH TIME ZONE, "user_id" uuid NOT NULL, CONSTRAINT "PK_d16bebd73e844c48bca50ff8d3d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "FK_52ac39dd8a28730c63aeb428c9c" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
