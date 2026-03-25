import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ProductCategory } from '../constants';
import { Product } from '../product.entity';

export class ProductImageDto {
  @ApiProperty()
  contentType: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  id: string;

  @ApiProperty()
  key: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  url: null | string;
}

export class ProductResponseDto {
  @ApiPropertyOptional({ nullable: true, type: Number })
  averageRating: null | number;

  @ApiPropertyOptional({ nullable: true, type: String })
  brand: null | string;

  @ApiProperty({ enum: ProductCategory })
  category: ProductCategory;

  @ApiPropertyOptional({ nullable: true, type: String })
  country: null | string;

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional({ nullable: true, type: String })
  description: null | string;

  @ApiProperty()
  id: string;

  @ApiPropertyOptional({ isArray: true, type: ProductImageDto })
  images?: ProductImageDto[];

  @ApiProperty()
  isActive: boolean;

  @ApiPropertyOptional({ nullable: true, type: String })
  mainImageId: null | string;

  @ApiPropertyOptional({ nullable: true, type: String })
  mainImageUrl: null | string;

  @ApiProperty()
  price: string;

  @ApiProperty()
  reviewsCount: number;

  @ApiProperty()
  stock: number;

  @ApiProperty()
  title: string;

  @ApiProperty()
  updatedAt: Date;

  static fromEntity(
    product: Product,
    mainImageUrl: null | string = null,
    images?: ProductImageDto[],
    averageRating: null | number = null,
    reviewsCount = 0,
  ): ProductResponseDto {
    const dto = new ProductResponseDto();
    dto.id = product.id;
    dto.title = product.title;
    dto.description = product.description ?? null;
    dto.brand = product.brand ?? null;
    dto.country = product.country ?? null;
    dto.category = product.category;
    dto.price = product.price;
    dto.stock = product.stock;
    dto.isActive = product.isActive;
    dto.mainImageId = product.mainImageId;
    dto.mainImageUrl = mainImageUrl;
    dto.createdAt = product.createdAt;
    dto.updatedAt = product.updatedAt;
    dto.averageRating = averageRating;
    dto.reviewsCount = reviewsCount;
    if (images !== undefined) {
      dto.images = images;
    }
    return dto;
  }
}

export class ProductDataResponseDto {
  @ApiProperty({ type: ProductResponseDto })
  data: ProductResponseDto;
}

export class ProductImagesDataResponseDto {
  @ApiProperty({ type: [ProductImageDto] })
  data: ProductImageDto[];
}

export class ProductsListResponseDto {
  @ApiProperty({ type: [ProductResponseDto] })
  data: ProductResponseDto[];

  @ApiProperty()
  limit: number;

  @ApiPropertyOptional({ nullable: true, type: String })
  nextCursor: null | string;
}
