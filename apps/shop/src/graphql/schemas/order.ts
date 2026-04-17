import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

import { OrderStatus } from '@/orders/order.entity';

import { OrderItemType } from './order-item';
import { UserType } from './user';

registerEnumType(OrderStatus, {
  description: 'The status of an order',
  name: 'OrderStatus',
});

@ObjectType()
export class OrderType {
  @Field(() => Date)
  createdAt: Date;

  @Field(() => ID)
  id: string;

  @Field(() => String, { nullable: true })
  idempotencyKey: null | string;

  @Field(() => [OrderItemType])
  items: OrderItemType[];

  @Field(() => OrderStatus)
  status: OrderStatus;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => UserType)
  user: UserType;

  @Field(() => ID)
  userId: string;
}

@ObjectType()
export class PageInfo {
  @Field(() => Boolean, { description: 'Whether there is a next page' })
  hasNextPage: boolean;

  @Field(() => String, { description: 'Cursor for the next page', nullable: true })
  nextCursor?: null | string;
}

@ObjectType()
export class OrdersConnection {
  @Field(() => [OrderType], { description: 'List of orders' })
  nodes: OrderType[];

  @Field(() => PageInfo, { description: 'Pagination information' })
  pageInfo: PageInfo;

  @Field(() => Int, { description: 'Total count of items', nullable: true })
  totalCount?: number;
}
