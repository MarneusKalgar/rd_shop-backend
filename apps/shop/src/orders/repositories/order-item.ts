import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';

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

  async findByOrderIdsWithRelations(
    orderIds: string[],
    manager?: EntityManager,
  ): Promise<OrderItem[]> {
    const repo = this.getRepository(manager);
    return repo.find({
      relations: ['product', 'order'],
      where: { orderId: In(orderIds) },
    });
  }

  async findByProductIdsWithRelations(
    productIds: string[],
    manager?: EntityManager,
  ): Promise<OrderItem[]> {
    const repo = this.getRepository(manager);
    return repo.find({
      relations: ['product', 'order'],
      where: { productId: In(productIds) },
    });
  }

  /**
   * Helper to get the appropriate repository (transactional or default).
   */
  private getRepository(manager?: EntityManager): Repository<OrderItem> {
    return manager ? manager.getRepository(OrderItem) : this.repository;
  }
}
