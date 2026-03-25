import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductReview1774465694090 implements MigrationInterface {
  name = 'AddProductReview1774465694090';

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "product_reviews" DROP CONSTRAINT "FK_8306941b81cb5be7d521bdc0834"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_reviews" DROP CONSTRAINT "FK_1d3fbb451c2b63d0a763f3ff5b1"`,
    );
    await queryRunner.query(`DROP TABLE "product_reviews"`);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "product_reviews" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "product_id" uuid NOT NULL, "rating" smallint NOT NULL, "text" character varying(1000) NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, CONSTRAINT "UQ_product_reviews_user_product" UNIQUE ("user_id", "product_id"), CONSTRAINT "CHK_0a2c70c7536639028c2799b6e4" CHECK ("rating" BETWEEN 1 AND 5), CONSTRAINT "PK_67c1501aea1b0633ec441b00bd5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_reviews" ADD CONSTRAINT "FK_1d3fbb451c2b63d0a763f3ff5b1" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_reviews" ADD CONSTRAINT "FK_8306941b81cb5be7d521bdc0834" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
