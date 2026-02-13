import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { Order, OrderStatus } from '../order.entity';

export class FindOrdersFilterDto {
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
    default: 20,
    description: 'Number of results to return',
    example: 20,
    maximum: 100,
    minimum: 1,
    required: false,
  })
  @IsInt()
  @IsOptional()
  @Max(100)
  @Min(1)
  @Type(() => Number)
  limit?: number;

  @ApiProperty({
    default: 0,
    description: 'Number of results to skip (for pagination)',
    example: 0,
    minimum: 0,
    required: false,
  })
  @IsInt()
  @IsOptional()
  @Min(0)
  @Type(() => Number)
  offset?: number;

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

  @ApiProperty({
    description: 'Search by user email (case-insensitive, partial match)',
    example: 'john',
    required: false,
  })
  @IsOptional()
  @IsString()
  userEmail?: string;
}

export class GetOrdersResponseDto {
  @ApiProperty({
    description: 'List of orders matching the filters',
    type: [Order], // You can replace Object with a more specific OrderDto if you have one
  })
  items: Order[];

  @ApiProperty({
    description: 'Current page number',
    example: 1,
  })
  page: number;

  @ApiProperty({
    description: 'Number of items per page',
    example: 20,
  })
  perPage: number;

  @ApiProperty({
    description: 'Total number of orders matching the filters (ignoring pagination)',
    example: 100,
  })
  total: number;
}
