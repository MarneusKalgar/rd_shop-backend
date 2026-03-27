import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCartAndCartItem1774549406627 implements MigrationInterface {
  name = 'AddCartAndCartItem1774549406627';

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cart_items" DROP CONSTRAINT "FK_30e89257a105eab7648a35c7fce"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_items" DROP CONSTRAINT "FK_6385a745d9e12a89b859bb25623"`,
    );
    await queryRunner.query(`ALTER TABLE "carts" DROP CONSTRAINT "FK_2ec1c94a977b940d85a4f498aea"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "shipping_postcode"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "shipping_phone"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "shipping_last_name"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "shipping_first_name"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "shipping_country"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "shipping_city"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cart_items_cart_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cart_items_product_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cart_items_cart_product"`);
    await queryRunner.query(`DROP TABLE "cart_items"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_carts_user_id"`);
    await queryRunner.query(`DROP TABLE "carts"`);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "carts" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, CONSTRAINT "UQ_2ec1c94a977b940d85a4f498aea" UNIQUE ("user_id"), CONSTRAINT "REL_2ec1c94a977b940d85a4f498ae" UNIQUE ("user_id"), CONSTRAINT "PK_b5f695a59f5ebb50af3c8160816" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_carts_user_id" ON "carts" ("user_id") `);
    await queryRunner.query(
      `CREATE TABLE "cart_items" ("added_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "cart_id" uuid NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "product_id" uuid NOT NULL, "quantity" integer NOT NULL, CONSTRAINT "PK_6fccf5ec03c172d27a28a82928b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_cart_items_cart_product" ON "cart_items" ("cart_id", "product_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cart_items_product_id" ON "cart_items" ("product_id") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_cart_items_cart_id" ON "cart_items" ("cart_id") `);
    await queryRunner.query(`ALTER TABLE "orders" ADD "shipping_city" character varying(100)`);
    await queryRunner.query(`ALTER TABLE "orders" ADD "shipping_country" character varying(2)`);
    await queryRunner.query(`ALTER TABLE "orders" ADD "shipping_first_name" character varying(50)`);
    await queryRunner.query(`ALTER TABLE "orders" ADD "shipping_last_name" character varying(50)`);
    await queryRunner.query(`ALTER TABLE "orders" ADD "shipping_phone" character varying(20)`);
    await queryRunner.query(`ALTER TABLE "orders" ADD "shipping_postcode" character varying(20)`);
    await queryRunner.query(
      `ALTER TABLE "carts" ADD CONSTRAINT "FK_2ec1c94a977b940d85a4f498aea" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_items" ADD CONSTRAINT "FK_6385a745d9e12a89b859bb25623" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_items" ADD CONSTRAINT "FK_30e89257a105eab7648a35c7fce" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }
}
