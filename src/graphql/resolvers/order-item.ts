import { Parent, ResolveField, Resolver } from '@nestjs/graphql';

import { OrderItem } from '@/orders/order-item.entity';
import { OrdersRepository } from '@/orders/repositories';

import { OrderType } from '../schemas/order';
import { OrderItemType } from '../schemas/order-item';

@Resolver(() => OrderItemType)
export class OrderItemResolver {
  constructor(private readonly ordersRepository: OrdersRepository) {}

  @ResolveField(() => OrderType)
  async order(@Parent() orderItem: OrderItem): Promise<OrderType> {
    // If the order is already loaded, return it
    if (orderItem.order) {
      return orderItem.order;
    }

    const order = await this.ordersRepository.findByIdWithRelations(orderItem.orderId);

    if (!order) {
      throw new Error(`Order with ID "${orderItem.orderId}" not found`);
    }

    return order;
  }
}
