import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

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
    description: 'Number of items per page',
    example: 10,
  })
  @IsInt()
  @IsOptional()
  @Max(100)
  @Min(1)
  @Type(() => Number)
  limit: number;

  @ApiPropertyOptional({
    description: 'Cursor for pagination (order ID to start after)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsUUID()
  nextCursor?: null | string;

  @ApiProperty({
    description: 'Total number of orders matching the filters (ignoring pagination)',
    example: 100,
  })
  @IsInt()
  @IsOptional()
  @Type(() => Number)
  total: number;
}
