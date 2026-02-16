import { Args, Query, Resolver } from '@nestjs/graphql';

import { OrdersService } from '@/orders/orders.service';

import { OrdersFilterInput, OrdersPaginationInput } from '../inputs';
import { OrdersConnection, OrderType } from '../schemas';

@Resolver(() => OrderType)
export class OrdersResolver {
  constructor(private readonly ordersService: OrdersService) {}

  @Query(() => OrdersConnection, {
    description: 'Get orders with optional filters and pagination',
    name: 'orders',
  })
  async getOrders(
    @Args('filter', { nullable: true, type: () => OrdersFilterInput }) filter?: OrdersFilterInput,
    @Args('pagination', { nullable: true, type: () => OrdersPaginationInput })
    pagination?: OrdersPaginationInput,
  ): Promise<OrdersConnection> {
    const filters = {
      ...filter,
      ...pagination,
    };

    const { nextCursor, orders } = await this.ordersService.findOrdersWithFilters(filters);

    return { nodes: orders, pageInfo: { hasNextPage: Boolean(nextCursor), nextCursor } };
  }
}
