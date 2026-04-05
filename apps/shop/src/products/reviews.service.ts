import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DEFAULT_REVIEWS_LIMIT } from './constants';
import {
  CreateReviewDto,
  FindReviewsQueryDto,
  ReviewDataResponseDto,
  ReviewResponseDto,
  ReviewsListResponseDto,
  UpdateReviewDto,
} from './dto';
import { ProductReview } from './product-review.entity';
import { Product } from './product.entity';
import { omitUndefined, throwOnUniqueViolation } from './utils';

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(ProductReview)
    private readonly reviewRepository: Repository<ProductReview>,
  ) {}

  async createReview(
    userId: string,
    productId: string,
    dto: CreateReviewDto,
  ): Promise<ReviewDataResponseDto> {
    await this.findProductOrFail(productId);

    const existing = await this.reviewRepository.findOne({ where: { productId, userId } });
    if (existing) {
      throw new ConflictException('You have already reviewed this product');
    }

    const review = this.reviewRepository.create({
      productId,
      rating: dto.rating,
      text: dto.text,
      userId,
    });

    try {
      await this.reviewRepository.save(review);
    } catch (error) {
      throwOnUniqueViolation(error, 'You have already reviewed this product');
    }

    const saved = await this.reviewRepository.findOneOrFail({
      relations: ['user'],
      where: { id: review.id },
    });

    this.logger.log(`User ${userId} created review for product ${productId}`);

    return { data: ReviewResponseDto.fromEntity(saved) };
  }

  async deleteReview(userId: string, productId: string): Promise<void> {
    await this.findProductOrFail(productId);

    const review = await this.reviewRepository.findOne({ where: { productId, userId } });

    if (!review) {
      throw new NotFoundException('Review not found');
    }

    await this.reviewRepository.remove(review);
    this.logger.log(`User ${userId} deleted review for product ${productId}`);
  }

  async getRatingInfo(
    productId: string,
  ): Promise<{ averageRating: null | number; reviewsCount: number }> {
    const result = await this.reviewRepository
      .createQueryBuilder('review')
      .select('ROUND(AVG(review.rating)::numeric, 2)', 'averageRating')
      .addSelect('COUNT(review.id)::int', 'reviewsCount')
      .where('review.productId = :productId', { productId })
      .getRawOne<{ averageRating: null | string; reviewsCount: number }>();

    return {
      averageRating: result?.averageRating ? Number(result.averageRating) : null,
      reviewsCount: result?.reviewsCount ?? 0,
    };
  }

  async getRatingInfoBatch(
    productIds: string[],
  ): Promise<Map<string, { averageRating: null | number; reviewsCount: number }>> {
    if (productIds.length === 0) return new Map();

    const results = await this.reviewRepository
      .createQueryBuilder('review')
      .select('review.productId', 'productId')
      .addSelect('ROUND(AVG(review.rating)::numeric, 2)', 'averageRating')
      .addSelect('COUNT(review.id)::int', 'reviewsCount')
      .where('review.productId IN (:...productIds)', { productIds })
      .groupBy('review.productId')
      .getRawMany<{ averageRating: null | string; productId: string; reviewsCount: number }>();

    const map = new Map<string, { averageRating: null | number; reviewsCount: number }>();
    for (const r of results) {
      map.set(r.productId, {
        averageRating: r.averageRating ? Number(r.averageRating) : null,
        reviewsCount: r.reviewsCount,
      });
    }
    return map;
  }

  async getReviews(productId: string, query: FindReviewsQueryDto): Promise<ReviewsListResponseDto> {
    await this.findProductOrFail(productId);

    const limit = query.limit ?? DEFAULT_REVIEWS_LIMIT;

    const qb = this.reviewRepository
      .createQueryBuilder('review')
      .leftJoinAndSelect('review.user', 'user')
      .where('review.productId = :productId', { productId });

    if (query.cursor) {
      const cursorReview = await this.reviewRepository.findOne({
        where: { id: query.cursor, productId },
      });
      if (cursorReview) {
        qb.andWhere(
          "(date_trunc('milliseconds', review.createdAt) < :cursorDate OR (date_trunc('milliseconds', review.createdAt) = :cursorDate AND review.id < :cursorId))",
          { cursorDate: cursorReview.createdAt, cursorId: cursorReview.id },
        );
      }
    }

    const reviews = await qb
      .orderBy('review.createdAt', 'DESC')
      .addOrderBy('review.id', 'DESC')
      .take(limit + 1)
      .getMany();

    const hasNextPage = reviews.length > limit;
    const page = hasNextPage ? reviews.slice(0, limit) : reviews;
    const nextCursor = hasNextPage ? page[page.length - 1].id : null;

    return { data: page.map((r) => ReviewResponseDto.fromEntity(r)), limit, nextCursor };
  }

  async updateReview(
    userId: string,
    productId: string,
    dto: UpdateReviewDto,
  ): Promise<ReviewDataResponseDto> {
    await this.findProductOrFail(productId);

    const review = await this.reviewRepository.findOne({
      relations: ['user'],
      where: { productId, userId },
    });

    if (!review) {
      throw new NotFoundException('Review not found');
    }

    Object.assign(review, omitUndefined(dto));
    await this.reviewRepository.save(review);

    return { data: ReviewResponseDto.fromEntity(review) };
  }

  private async findProductOrFail(id: string): Promise<Product> {
    const product = await this.productRepository.findOne({ where: { id } });
    if (!product) {
      throw new NotFoundException(`Product with ID "${id}" not found`);
    }
    return product;
  }
}
