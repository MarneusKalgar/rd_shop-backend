import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/auth/decorators/current-user';
import { JwtAuthGuard } from '@/auth/guards';
import { AuthUser } from '@/auth/types';

import {
  CreateReviewDto,
  FindReviewsQueryDto,
  ReviewDataResponseDto,
  ReviewsListResponseDto,
  UpdateReviewDto,
} from '../dto';
import { ReviewsService } from '../reviews.service';

@ApiTags('products')
@Controller({ path: 'products', version: '1' })
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @ApiOperation({ summary: 'Submit a review for a product' })
  @ApiResponse({ status: HttpStatus.CREATED, type: ReviewDataResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  @ApiResponse({ description: 'Already reviewed this product', status: HttpStatus.CONFLICT })
  @Post(':id/reviews')
  @UseGuards(JwtAuthGuard)
  async createReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateReviewDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ReviewDataResponseDto> {
    return this.reviewsService.createReview(user.sub, id, dto);
  }

  @ApiOperation({ summary: 'Delete your review for a product' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  @Delete(':id/reviews')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async deleteReview(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.reviewsService.deleteReview(user.sub, id);
  }

  @ApiOperation({ summary: 'List reviews for a product' })
  @ApiResponse({ status: HttpStatus.OK, type: ReviewsListResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  @Get(':id/reviews')
  async getReviews(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: FindReviewsQueryDto,
  ): Promise<ReviewsListResponseDto> {
    return this.reviewsService.getReviews(id, query);
  }

  @ApiOperation({ summary: 'Update your review for a product' })
  @ApiResponse({ status: HttpStatus.OK, type: ReviewDataResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  @Patch(':id/reviews')
  @UseGuards(JwtAuthGuard)
  async updateReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReviewDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ReviewDataResponseDto> {
    return this.reviewsService.updateReview(user.sub, id, dto);
  }
}
