import { Field, InputType, Int } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

import { MAX_ORDERS_LIMIT } from '@/orders/constants';
import { OrderStatus } from '@/orders/order.entity';

@InputType()
export class OrdersFilterInput {
  @Field(() => Date, { description: 'Filter orders created before this date', nullable: true })
  @IsDate()
  @IsOptional()
  @Type(() => Date)
  endDate?: Date;

  @Field(() => String, {
    description: 'Search by product name (case-insensitive, partial match)',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  productName?: string;

  @Field(() => Date, { description: 'Filter orders created after this date', nullable: true })
  @IsDate()
  @IsOptional()
  @Type(() => Date)
  startDate?: Date;

  @Field(() => String, { description: 'Filter by order status', nullable: true })
  @IsEnum(OrderStatus)
  @IsOptional()
  status?: OrderStatus;

  @Field(() => String, {
    description: 'Search by user email (case-insensitive, partial match)',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  userEmail?: string;
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
    defaultValue: 10,
    description: 'Number of results to return',
    nullable: true,
  })
  @IsInt()
  @IsOptional()
  @Max(MAX_ORDERS_LIMIT)
  @Min(1)
  @Type(() => Number)
  limit?: number;
}
