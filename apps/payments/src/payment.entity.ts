import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum PaymentStatus {
  AUTHORIZED = 1,
  CAPTURED = 2,
  REFUNDED = 3,
  FAILED = 4,
  PENDING = 5,
}

@Entity('payments')
@Index('IDX_payments_order_id', ['orderId'])
@Index('IDX_payments_status', ['status'])
@Index('IDX_payments_created_at', ['createdAt'])
export class Payment {
  @Column('numeric', { precision: 12, scale: 2 })
  amount: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ length: 3, type: 'varchar' })
  currency: string;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  @Index()
  orderId: string;

  @Column({
    length: 255,
    name: 'payment_id',
    nullable: false,
    type: 'varchar',
    unique: true,
  })
  paymentId: string;

  @Column({ name: 'status', type: 'smallint' })
  status: PaymentStatus;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
