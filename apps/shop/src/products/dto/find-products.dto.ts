import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO31661Alpha2,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { toArray } from '@/common/dto';

import {
  DEFAULT_PRODUCTS_LIMIT,
  MAX_PRODUCTS_LIMIT,
  MIN_PRODUCTS_LIMIT,
  ProductCategory,
  ProductSortBy,
  SortOrder,
} from '../constants';

export class FindProductsQueryDto {
  @ApiPropertyOptional({
    description:
      'Filter by brand name(s) (partial, case-insensitive). Accepts a single value or an array.',
    example: ['Sony', 'Apple'],
    isArray: true,
    maxLength: 100,
    type: String,
  })
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @Transform(toArray)
  brand?: string[];

  @ApiPropertyOptional({ description: 'Filter by category', enum: ProductCategory })
  @IsEnum(ProductCategory)
  @IsOptional()
  category?: ProductCategory;

  @ApiPropertyOptional({
    description:
      'Filter by ISO 3166-1 alpha-2 country code(s). Accepts a single value or an array.',
    example: ['JP', 'US'],
    isArray: true,
    type: String,
  })
  @IsArray()
  @IsISO31661Alpha2({ each: true })
  @IsOptional()
  @Transform(toArray)
  country?: string[];

  @ApiPropertyOptional({ description: 'Cursor for keyset pagination' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Filter by active status', example: true })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  isActive?: boolean;

  @ApiPropertyOptional({
    default: DEFAULT_PRODUCTS_LIMIT,
    description: 'Number of results to return',
    maximum: MAX_PRODUCTS_LIMIT,
    minimum: MIN_PRODUCTS_LIMIT,
  })
  @IsInt()
  @IsOptional()
  @Max(MAX_PRODUCTS_LIMIT)
  @Min(MIN_PRODUCTS_LIMIT)
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({ description: 'Maximum price filter', example: '999.99' })
  @IsOptional()
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'maxPrice must be a valid decimal number' })
  maxPrice?: string;

  @ApiPropertyOptional({ description: 'Minimum price filter', example: '10.00' })
  @IsOptional()
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'minPrice must be a valid decimal number' })
  minPrice?: string;

  @ApiPropertyOptional({
    description: 'Search term matched against title and description (case-insensitive)',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({
    default: ProductSortBy.CREATED_AT,
    description: 'Field to sort by',
    enum: ProductSortBy,
  })
  @IsEnum(ProductSortBy)
  @IsOptional()
  sortBy?: ProductSortBy;

  @ApiPropertyOptional({ default: SortOrder.DESC, description: 'Sort direction', enum: SortOrder })
  @IsEnum(SortOrder)
  @IsOptional()
  sortOrder?: SortOrder;
}
