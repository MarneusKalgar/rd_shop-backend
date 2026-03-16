import { Injectable, Scope } from '@nestjs/common';
//import { InjectRepository } from '@nestjs/typeorm';
import DataLoader from 'dataloader';
// import { In, Repository } from 'typeorm';

import { Order } from '@/orders/order.entity';
import { OrdersRepository } from '@/orders/repositories';

@Injectable({ scope: Scope.REQUEST })
export class OrderLoader {
  /**
   * Loader for fetching orders by ID with all relations
   */
  readonly byId = new DataLoader<string, null | Order>(async (orderIds: readonly string[]) => {
    if (!orderIds.length) {
      return [];
    }

    const orders = await this.ordersRepository.findByOrderIdsWithRelations([...orderIds]);

    const orderMap = new Map(orders.map((order) => [order.id, order]));

    return orderIds.map((id) => orderMap.get(id) ?? null);
  });

  /**
   * Loader for fetching orders by user ID
   */
  readonly byUserId = new DataLoader<string, Order[]>(async (userIds: readonly string[]) => {
    const orders = await this.ordersRepository.findByUserIdsWithRelations([...userIds]);

    const ordersByUserId = new Map<string, Order[]>();
    orders.forEach((order) => {
      const existing = ordersByUserId.get(order.userId) ?? [];
      ordersByUserId.set(order.userId, [...existing, order]);
    });

    // Return orders in the same order as requested user IDs
    return userIds.map((userId) => ordersByUserId.get(userId) ?? []);
  });

  constructor(private readonly ordersRepository: OrdersRepository) {}
}
