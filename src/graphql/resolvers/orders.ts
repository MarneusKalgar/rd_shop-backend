import { Args, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { GraphQLError } from 'graphql';

import { Order } from '@/orders/order.entity';
import { OrdersService } from '@/orders/orders.service';

import { OrdersFilterInput, OrdersPaginationInput } from '../inputs';
import { OrderItemLoader, UserLoader } from '../loaders';
import { OrderItemType, OrdersConnection, OrderType, UserType } from '../schemas';

@Resolver(() => OrderType)
export class OrdersResolver {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderItemLoader: OrderItemLoader,
    private readonly userLoader: UserLoader,
  ) {}

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

  @ResolveField(() => [OrderItemType])
  async items(@Parent() order: Order): Promise<OrderItemType[]> {
    if (order.items) {
      return order.items;
    }

    return this.orderItemLoader.byOrderId.load(order.id);
  }

  @ResolveField(() => UserType)
  async user(@Parent() order: Order): Promise<UserType> {
    if (order.user) {
      return order.user;
    }

    const user = await this.userLoader.byId.load(order.userId);

    if (!user) {
      throw new GraphQLError(`User with ID "${order.userId}" not found`, {
        extensions: { code: 'USER_NOT_FOUND', userId: order.userId },
      });
    }

    return user;
  }
}
