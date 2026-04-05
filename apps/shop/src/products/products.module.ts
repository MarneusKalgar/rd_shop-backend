import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FilesModule } from '../files/files.module';
import { ProductReview } from './product-review.entity';
import { Product } from './product.entity';
import { ProductsRepository } from './product.repository';
import { ProductsService } from './products.service';
import { ReviewsService } from './reviews.service';
import { AdminProductsController } from './v1/admin-products.controller';
import { ProductsController } from './v1/products.controller';
import { ReviewsController } from './v1/reviews.controller';

@Module({
  controllers: [ProductsController, AdminProductsController, ReviewsController],
  exports: [TypeOrmModule, ProductsService, ProductsRepository, ReviewsService],
  imports: [TypeOrmModule.forFeature([Product, ProductReview]), FilesModule],
  providers: [ProductsService, ProductsRepository, ReviewsService],
})
export class ProductsModule {}
