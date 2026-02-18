import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

import { OrderItemType } from './order-item';

@ObjectType()
export class ProductType {
  @Field(() => Date)
  createdAt: Date;

  @Field(() => ID)
  id: string;

  @Field(() => Boolean)
  isActive: boolean;

  @Field(() => [OrderItemType])
  orderItems: OrderItemType[];

  @Field(() => String)
  price: string;

  @Field(() => Int)
  stock: number;

  @Field(() => String)
  title: string;

  @Field(() => Date)
  updatedAt: Date;
}
