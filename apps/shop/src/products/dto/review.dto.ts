import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { DEFAULT_REVIEWS_LIMIT, MAX_REVIEWS_LIMIT, MIN_REVIEWS_LIMIT } from '../constants';
import { ProductReview } from '../product-review.entity';

export class CreateReviewDto {
  @ApiProperty({ description: 'Rating from 1 to 5', example: 4, maximum: 5, minimum: 1 })
  @IsInt()
  @Max(5)
  @Min(1)
  rating: number;

  @ApiProperty({ description: 'Review text', example: 'Great product!', maxLength: 1000 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  text: string;
}

export class FindReviewsQueryDto {
  @ApiPropertyOptional({ description: 'Cursor (review ID) for pagination', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({
    default: DEFAULT_REVIEWS_LIMIT,
    description: 'Number of reviews per page',
    maximum: MAX_REVIEWS_LIMIT,
    minimum: MIN_REVIEWS_LIMIT,
  })
  @IsInt()
  @IsOptional()
  @Max(MAX_REVIEWS_LIMIT)
  @Min(MIN_REVIEWS_LIMIT)
  @Type(() => Number)
  limit?: number;
}

export class ReviewUserDto {
  @ApiPropertyOptional({ nullable: true, type: String })
  firstName: null | string;

  @ApiProperty()
  id: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  lastName: null | string;
}

export class ReviewResponseDto {
  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  id: string;

  @ApiProperty()
  productId: string;

  @ApiProperty({ maximum: 5, minimum: 1 })
  rating: number;

  @ApiProperty()
  text: string;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ type: ReviewUserDto })
  user: ReviewUserDto;

  static fromEntity(review: ProductReview): ReviewResponseDto {
    const dto = new ReviewResponseDto();
    dto.id = review.id;
    dto.productId = review.productId;
    dto.rating = review.rating;
    dto.text = review.text;
    dto.createdAt = review.createdAt;
    dto.updatedAt = review.updatedAt;
    dto.user = review.user
      ? { firstName: review.user.firstName, id: review.user.id, lastName: review.user.lastName }
      : { firstName: null, id: review.userId, lastName: null };
    return dto;
  }
}

export class ReviewDataResponseDto {
  @ApiProperty({ type: ReviewResponseDto })
  data: ReviewResponseDto;
}

export class ReviewsListResponseDto {
  @ApiProperty({ type: [ReviewResponseDto] })
  data: ReviewResponseDto[];

  @ApiProperty()
  limit: number;

  @ApiPropertyOptional({ nullable: true, type: String })
  nextCursor: null | string;
}

export class UpdateReviewDto {
  @ApiPropertyOptional({ description: 'Rating from 1 to 5', example: 4, maximum: 5, minimum: 1 })
  @IsInt()
  @IsOptional()
  @Max(5)
  @Min(1)
  rating?: number;

  @ApiPropertyOptional({ description: 'Review text', example: 'Updated thoughts', maxLength: 1000 })
  @IsNotEmpty()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  text?: string;
}
