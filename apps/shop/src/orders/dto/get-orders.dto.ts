import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

import { DEFAULT_ORDERS_LIMIT, MAX_ORDERS_LIMIT, MIN_ORDERS_LIMIT } from '../constants';
import { Order, OrderStatus } from '../order.entity';

export class FindOrdersFilterDto {
  @ApiPropertyOptional({
    description: 'Cursor for pagination (order ID to start after)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiProperty({
    description: 'Filter orders created before this date',
    example: '2024-12-31T23:59:59.999Z',
    required: false,
    type: Date,
  })
  @IsDate()
  @IsOptional()
  @Type(() => Date)
  endDate?: Date;

  @ApiProperty({
    default: DEFAULT_ORDERS_LIMIT,
    description: 'Number of results to return',
    example: DEFAULT_ORDERS_LIMIT,
    maximum: MAX_ORDERS_LIMIT,
    minimum: MIN_ORDERS_LIMIT,
    required: false,
  })
  @IsInt()
  @IsOptional()
  @Max(MAX_ORDERS_LIMIT)
  @Min(MIN_ORDERS_LIMIT)
  @Type(() => Number)
  limit?: number;

  @ApiProperty({
    description: 'Search by product name (case-insensitive, partial match)',
    example: 'headphones',
    required: false,
  })
  @IsOptional()
  @IsString()
  productName?: string;

  @ApiProperty({
    description: 'Filter orders created after this date',
    example: '2024-01-01T00:00:00.000Z',
    required: false,
    type: Date,
  })
  @IsDate()
  @IsOptional()
  @Type(() => Date)
  startDate?: Date;

  @ApiProperty({
    description: 'Filter by order status',
    enum: OrderStatus,
    example: OrderStatus.PAID,
    required: false,
  })
  @IsEnum(OrderStatus)
  @IsOptional()
  status?: OrderStatus;
}

export class GetOrdersResponseDto {
  @ApiProperty({
    description: 'List of orders matching the filters',
    type: [Order], // You can replace Object with a more specific OrderDto if you have one
  })
  data: Order[];

  @ApiProperty({
    description: 'Number of items per page',
    example: DEFAULT_ORDERS_LIMIT,
  })
  @IsInt()
  @IsOptional()
  @Max(MAX_ORDERS_LIMIT)
  @Min(MIN_ORDERS_LIMIT)
  @Type(() => Number)
  limit: number;

  @ApiPropertyOptional({
    description: 'Cursor for pagination (order ID to start after)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsUUID()
  nextCursor?: null | string;
}
