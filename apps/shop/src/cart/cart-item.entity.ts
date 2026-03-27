import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Product } from '../products/product.entity';
import { Cart } from './cart.entity';

@Entity('cart_items')
@Index('IDX_cart_items_cart_id', ['cartId'])
@Index('IDX_cart_items_product_id', ['productId'])
@Index('IDX_cart_items_cart_product', ['cartId', 'productId'], { unique: true })
export class CartItem {
  @CreateDateColumn({ name: 'added_at', type: 'timestamptz' })
  addedAt: Date;

  @JoinColumn({ name: 'cart_id' })
  @ManyToOne(() => Cart, (cart) => cart.items, { onDelete: 'CASCADE' })
  cart: Cart;

  @Column({ name: 'cart_id', type: 'uuid' })
  cartId: string;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @JoinColumn({ name: 'product_id' })
  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  product: Product;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ type: 'int' })
  quantity: number;
}
