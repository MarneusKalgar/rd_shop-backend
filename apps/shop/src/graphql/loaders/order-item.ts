import { Injectable, Scope } from '@nestjs/common';
import DataLoader from 'dataloader';

import { OrderItem } from '@/orders/order-item.entity';
import { OrderItemsRepository } from '@/orders/repositories';

@Injectable({ scope: Scope.REQUEST })
export class OrderItemLoader {
  /**
   * Loader for fetching order items by order ID
   */
  readonly byOrderId = new DataLoader<string, OrderItem[]>(async (orderIds: readonly string[]) => {
    const orderItems = await this.orderItemsRepository.findByOrderIdsWithRelations([...orderIds]);

    const itemsByOrderId = new Map<string, OrderItem[]>();
    orderItems.forEach((item) => {
      const existing = itemsByOrderId.get(item.orderId) ?? [];
      itemsByOrderId.set(item.orderId, [...existing, item]);
    });

    // Return items in the same order as requested order IDs
    return orderIds.map((orderId) => itemsByOrderId.get(orderId) ?? []);
  });

  /**
   * Loader for fetching order items by product ID
   */
  readonly byProductId = new DataLoader<string, OrderItem[]>(
    async (productIds: readonly string[]) => {
      const orderItems = await this.orderItemsRepository.findByProductIdsWithRelations([
        ...productIds,
      ]);

      const itemsByProductId = new Map<string, OrderItem[]>();
      orderItems.forEach((item) => {
        const existing = itemsByProductId.get(item.productId) ?? [];
        itemsByProductId.set(item.productId, [...existing, item]);
      });

      return productIds.map((productId) => itemsByProductId.get(productId) ?? []);
    },
  );

  constructor(private readonly orderItemsRepository: OrderItemsRepository) {}
}
