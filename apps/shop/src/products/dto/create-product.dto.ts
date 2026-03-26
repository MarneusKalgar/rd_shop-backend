import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO31661Alpha2,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';

import { ProductCategory } from '../constants';

export class CreateProductDto {
  @ApiPropertyOptional({ description: 'Brand name', example: 'Sony', maxLength: 100 })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  brand?: string;

  @ApiPropertyOptional({
    description: 'Product category',
    enum: ProductCategory,
    example: ProductCategory.OTHER,
  })
  @IsEnum(ProductCategory)
  @IsOptional()
  category?: ProductCategory;

  @ApiPropertyOptional({ description: 'ISO 3166-1 alpha-2 country of origin', example: 'JP' })
  @IsISO31661Alpha2()
  @IsOptional()
  country?: string;

  @ApiPropertyOptional({ description: 'Product description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ default: true, description: 'Whether the product is active' })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiProperty({
    description: 'Price as decimal string with up to 2 decimal places',
    example: '299.99',
  })
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'price must be a valid decimal number with up to 2 decimal places',
  })
  price: string;

  @ApiPropertyOptional({ description: 'Available stock quantity', example: 100, minimum: 0 })
  @IsInt()
  @IsOptional()
  @Min(0)
  @Type(() => Number)
  stock?: number;

  @ApiProperty({
    description: 'Product title (must be unique)',
    example: 'Wireless Headphones',
    maxLength: 200,
  })
  @IsNotEmpty()
  @IsString()
  @Length(1, 200)
  title: string;
}
