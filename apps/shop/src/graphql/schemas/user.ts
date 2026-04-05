import { Field, ID, ObjectType } from '@nestjs/graphql';

import { OrderType } from './order';

@ObjectType()
export class UserType {
  @Field(() => String, { nullable: true })
  avatarId: null | string;

  @Field(() => String, { nullable: true })
  avatarUrl?: null | string;

  @Field(() => String, { nullable: true })
  city: null | string;

  @Field(() => String, { nullable: true })
  country: null | string;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => String)
  email: string;

  @Field(() => String, { nullable: true })
  firstName: null | string;

  @Field(() => ID)
  id: string;

  @Field(() => Boolean)
  isEmailVerified: boolean;

  @Field(() => String, { nullable: true })
  lastName: null | string;

  @Field(() => [OrderType])
  orders: OrderType[];

  @Field(() => String, { nullable: true })
  phone: null | string;

  @Field(() => String, { nullable: true })
  postcode: null | string;

  @Field(() => [String])
  roles: string[];

  @Field(() => Date)
  updatedAt: Date;
}
