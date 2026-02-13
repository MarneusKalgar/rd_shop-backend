import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { Product } from '../products/product.entity';
import { Order } from './order.entity';

@Entity('order_items')
@Index('IDX_order_items_order_id', ['orderId'])
@Index('IDX_order_items_product_id', ['productId'])
@Index('IDX_order_items_order_product', ['orderId', 'productId'])
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @JoinColumn({ name: 'order_id' })
  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  order: Order;
  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column('numeric', { name: 'price_at_purchase', precision: 12, scale: 2 })
  priceAtPurchase: string;
  @JoinColumn({ name: 'product_id' })
  @ManyToOne(() => Product, (product) => product.orderItems, { onDelete: 'RESTRICT' })
  product: Product;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ type: 'int' })
  quantity: number;
}
