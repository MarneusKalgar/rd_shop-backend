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

import { FileRecord } from '../files/file-record.entity';
import { OrderItem } from '../orders/order-item.entity';

@Entity('products')
@Index('IDX_products_title_unique', ['title'], { unique: true })
@Index('IDX_products_main_image_id', ['mainImageId'])
export class Product {
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: true, name: 'is_active', type: 'boolean' })
  isActive: boolean;

  @JoinColumn({ name: 'main_image_id' })
  @ManyToOne(() => FileRecord, { nullable: true, onDelete: 'SET NULL' })
  mainImage: FileRecord | null;

  @Column({ name: 'main_image_id', nullable: true, type: 'uuid' })
  mainImageId: null | string;

  @OneToMany(() => OrderItem, (item) => item.product)
  orderItems: OrderItem[];

  @Column('numeric', { precision: 12, scale: 2 })
  price: string;

  @Column({ default: 0, name: 'stock', type: 'int' })
  stock: number;

  @Column({ length: 200, type: 'varchar' })
  title: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
