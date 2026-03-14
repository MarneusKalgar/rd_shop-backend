import { Field, ID, ObjectType } from '@nestjs/graphql';

import { OrderType } from './order';

@ObjectType()
export class UserType {
  @Field(() => Date)
  createdAt: Date;

  @Field(() => String)
  email: string;

  @Field(() => ID)
  id: string;

  @Field(() => [OrderType])
  orders: OrderType[];

  @Field(() => Date)
  updatedAt: Date;
}
