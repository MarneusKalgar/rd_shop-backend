import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('processed_messages')
@Index('UQ_processed_messages_message_id', ['messageId'], { unique: true })
@Index('UQ_processed_messages_idempotency_key', ['idempotencyKey'], {
  unique: true,
  where: '"idempotency_key" IS NOT NULL',
})
export class ProcessedMessage {
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255, name: 'idempotency_key', nullable: true, type: 'varchar' })
  idempotencyKey: null | string;

  @Column({ length: 200, name: 'message_id', type: 'varchar' })
  messageId: string;

  @Column({ length: 100, name: 'scope', type: 'varchar' })
  scope: string;
}
