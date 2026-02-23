import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Product } from './product.entity';
import { ProductsService } from './products.service';

@Module({
  exports: [TypeOrmModule, ProductsService],
  imports: [TypeOrmModule.forFeature([Product])],
  providers: [ProductsService],
})
export class ProductsModule {}
