import { Parent, ResolveField, Resolver } from '@nestjs/graphql';

import { OrderItem } from '@/orders/order-item.entity';

import { OrderLoader, ProductLoader } from '../loaders';
import { ProductType } from '../schemas';
import { OrderType } from '../schemas/order';
import { OrderItemType } from '../schemas/order-item';

@Resolver(() => OrderItemType)
export class OrderItemResolver {
  constructor(
    //private readonly ordersRepository: OrdersRepository,
    private readonly orderLoader: OrderLoader,
    private readonly productLoader: ProductLoader,
  ) {}

  @ResolveField(() => OrderType)
  async order(@Parent() orderItem: OrderItem): Promise<OrderType> {
    if (orderItem.order) {
      return orderItem.order;
    }

    const order = await this.orderLoader.byId.load(orderItem.orderId);

    if (!order) {
      throw new Error(`Order with ID "${orderItem.orderId}" not found`);
    }

    return order;
  }

  @ResolveField(() => ProductType)
  async product(@Parent() orderItem: OrderItem): Promise<ProductType> {
    if (orderItem.product) {
      return orderItem.product;
    }

    const product = await this.productLoader.byId.load(orderItem.productId);

    if (!product) {
      throw new Error(`Product with ID "${orderItem.productId}" not found`);
    }

    return product;
  }
}
