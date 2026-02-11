import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateOrderItemDto {
  @ApiProperty({
    description: 'ID of the product to order',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsNotEmpty()
  @IsUUID()
  productId: string;

  @ApiProperty({
    description: 'Quantity of the product to order',
    example: 1,
  })
  @IsInt()
  @Max(10000, { message: 'Quantity cannot exceed 10,000' })
  @Min(1)
  quantity: number;
}

export class CreateOrderDto {
  @ApiProperty({
    description:
      'Optional idempotency key to prevent duplicate order creation. Use a UUID or unique string. If the same key is sent twice, the existing order will be returned.',
    example: '550e8400-e29b-41d4-a716-446655440000',
    required: false,
  })
  @IsNotEmpty()
  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @ApiProperty({
    description: 'List of items to order',
    type: [CreateOrderItemDto],
  })
  @ArrayMinSize(1)
  @IsArray()
  @Type(() => CreateOrderItemDto)
  @ValidateNested({ each: true })
  items: CreateOrderItemDto[];

  @ApiProperty({
    description: 'ID of the user placing the order',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsNotEmpty()
  @IsUUID()
  userId: string;
}
