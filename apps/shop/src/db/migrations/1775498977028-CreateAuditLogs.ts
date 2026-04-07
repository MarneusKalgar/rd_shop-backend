import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuditLogs1775498977028 implements MigrationInterface {
  name = 'CreateAuditLogs1775498977028';

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "audit_logs"`);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "audit_logs" ("action" character varying(100) NOT NULL, "actor_id" uuid, "actor_role" character varying(50), "correlation_id" character varying(255), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "ip" character varying(45), "outcome" character varying(20) NOT NULL, "reason" text, "target_id" character varying(255), "target_type" character varying(100), "user_agent" text, CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`,
    );
  }
}
