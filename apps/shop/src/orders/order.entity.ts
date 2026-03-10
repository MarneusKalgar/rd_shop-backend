import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../users/user.entity';
import { OrderItem } from './order-item.entity';

export enum OrderStatus {
  CANCELLED = 'CANCELLED',
  CREATED = 'CREATED',
  PAID = 'PAID',
  PENDING = 'PENDING',
  PROCESSED = 'PROCESSED',
}

@Entity('orders')
@Index('IDX_orders_user_id', ['userId'])
@Index('IDX_orders_created_at', ['createdAt'])
@Index('IDX_orders_user_created', ['userId', 'createdAt'])
@Index('IDX_orders_status_created', ['status', 'createdAt'])
// @Index('IDX_orders_payment_id', ['paymentId'])
export class Order {
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255, name: 'idempotency_key', nullable: true, type: 'varchar', unique: true })
  idempotencyKey: null | string;

  @OneToMany(() => OrderItem, (item) => item.order)
  items: OrderItem[];

  @Column({
    length: 255,
    name: 'payment_id',
    nullable: true,
    type: 'varchar',
    unique: true,
  })
  paymentId: null | string;

  @Column({
    default: OrderStatus.PENDING,
    enum: OrderStatus,
    enumName: 'orders_status_enum',
    type: 'enum',
  })
  status: OrderStatus;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @JoinColumn({ name: 'user_id' })
  @ManyToOne(() => User, (user) => user.orders, { onDelete: 'CASCADE' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;
}
