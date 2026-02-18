import { Field, InputType, Int } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

import { DEFAULT_ORDERS_LIMIT, MAX_ORDERS_LIMIT, MIN_ORDERS_LIMIT } from '@/orders/constants';
import { OrderStatus } from '@/orders/order.entity';

@InputType()
export class OrdersFilterInput {
  @Field(() => Date, { description: 'Filter orders created before this date', nullable: true })
  @IsDate()
  @IsOptional()
  @Type(() => Date)
  endDate?: Date;

  @Field(() => Date, { description: 'Filter orders created after this date', nullable: true })
  @IsDate()
  @IsOptional()
  @Type(() => Date)
  startDate?: Date;

  @Field(() => String, { description: 'Filter by order status', nullable: true })
  @IsEnum(OrderStatus)
  @IsOptional()
  status?: OrderStatus;
}

@InputType()
export class OrdersPaginationInput {
  @Field(() => String, {
    description: 'Cursor for pagination (order ID to start after)',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @Field(() => Int, {
    defaultValue: DEFAULT_ORDERS_LIMIT,
    description: 'Number of results to return',
    nullable: true,
  })
  @IsInt()
  @IsOptional()
  @Max(MAX_ORDERS_LIMIT)
  @Min(MIN_ORDERS_LIMIT)
  @Type(() => Number)
  limit?: number;
}
