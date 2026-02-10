import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { OrderItem } from '../orders/order-item.entity';

@Entity('products')
@Index('IDX_products_title_unique', ['title'], { unique: true })
export class Product {
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: true, name: 'is_active', type: 'boolean' })
  isActive: boolean;

  @OneToMany(() => OrderItem, (item) => item.product)
  orderItems: OrderItem[];

  @Column('numeric', { precision: 12, scale: 2 })
  price: string;

  @Column({ length: 200, type: 'varchar' })
  title: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
