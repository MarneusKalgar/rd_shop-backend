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
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { MAX_ORDER_QUANTITY } from '../constants';
import { Order } from '../order.entity';

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
  @Max(MAX_ORDER_QUANTITY, { message: `Quantity cannot exceed ${MAX_ORDER_QUANTITY}` })
  @Min(1)
  quantity: number;
}

export class ShippingAddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postcode?: string;
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
    description:
      'Optional shipping address. If omitted, the address from the user profile is used as a fallback.',
    required: false,
    type: ShippingAddressDto,
  })
  @IsOptional()
  @Type(() => ShippingAddressDto)
  @ValidateNested()
  shipping?: ShippingAddressDto;
}

export class CreateOrderResponseDto {
  @ApiProperty({
    description: 'The created order',
    type: Object,
  })
  data: Order;
}
