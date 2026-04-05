import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../users/user.entity';
import { Product } from './product.entity';

@Check('"rating" BETWEEN 1 AND 5')
@Entity('product_reviews')
@Unique('UQ_product_reviews_user_product', ['userId', 'productId'])
export class ProductReview {
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @JoinColumn({ name: 'product_id' })
  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  product: Product;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ type: 'smallint' })
  rating: number;

  @Column({ length: 1000, type: 'varchar' })
  text: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @JoinColumn({ name: 'user_id' })
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;
}
