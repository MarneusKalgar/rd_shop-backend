import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

import { OrderType } from './order';
import { ProductType } from './product';

@ObjectType()
export class OrderItemType {
  @Field(() => ID)
  id: string;

  @Field(() => OrderType)
  order: OrderType;

  @Field(() => ID)
  orderId: string;

  @Field(() => String)
  priceAtPurchase: string;

  @Field(() => ProductType)
  product: ProductType;

  @Field(() => ID)
  productId: string;

  @Field(() => Int)
  quantity: number;
}
