import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { Product } from '../../products/product.entity';
import { OrderItem } from '../order-item.entity';
import { Order } from '../order.entity';

export interface OrderItemData {
  order: Order;
  orderId: string;
  priceAtPurchase: string;
  product: Product;
  productId: string;
  quantity: number;
}

@Injectable()
export class OrderItemsRepository {
  constructor(
    @InjectRepository(OrderItem)
    private readonly repository: Repository<OrderItem>,
  ) {}

  async createOrderItems(
    manager: EntityManager,
    orderItemsData: OrderItemData[],
  ): Promise<OrderItem[]> {
    const repo = this.getRepository(manager);
    const orderItems = orderItemsData.map((data) => repo.create(data));
    return repo.save(orderItems);
  }

  /**
   * Helper to get the appropriate repository (transactional or default).
   */
  private getRepository(manager?: EntityManager): Repository<OrderItem> {
    return manager ? manager.getRepository(OrderItem) : this.repository;
  }
}
