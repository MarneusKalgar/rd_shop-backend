import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

import { ShippingAddressDto } from '@/orders/dto';
import { Product } from '@/products/product.entity';

export class AddCartItemDto {
  @ApiProperty({
    description: 'ID of the product to add',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsNotEmpty()
  @IsUUID()
  productId: string;

  @ApiProperty({
    description: 'Quantity to add',
    example: 1,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  quantity: number;
}

export class CartCheckoutDto {
  @ApiProperty({
    description: 'Optional idempotency key forwarded to order creation',
    example: '550e8400-e29b-41d4-a716-446655440000',
    required: false,
  })
  @IsNotEmpty()
  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @ApiProperty({
    description: 'Optional shipping address override. Falls back to user profile if omitted.',
    required: false,
    type: ShippingAddressDto,
  })
  @IsOptional()
  @Type(() => ShippingAddressDto)
  @ValidateNested()
  shipping?: ShippingAddressDto;
}

export class CartItemResponseDto {
  @ApiProperty()
  addedAt: Date;

  @ApiProperty()
  cartId: string;

  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'Line total (price × quantity)', example: '19.98' })
  itemTotal: string;

  @ApiProperty({ type: () => Product })
  product: Product;

  @ApiProperty()
  productId: string;

  @ApiProperty()
  quantity: number;
}

export class CartResponseDto {
  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  id: string;

  @ApiProperty({ type: [CartItemResponseDto] })
  items: CartItemResponseDto[];

  @ApiProperty({ description: 'Cart grand total', example: '49.96' })
  total: string;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty()
  userId: string;
}

export class GetCartResponseDto {
  @ApiProperty({ type: CartResponseDto })
  data: CartResponseDto;
}

export class UpdateCartItemDto {
  @ApiProperty({
    description: 'New quantity',
    example: 2,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  quantity: number;
}
