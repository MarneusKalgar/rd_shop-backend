import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Product } from './product.entity';

@Module({
  exports: [TypeOrmModule],
  imports: [TypeOrmModule.forFeature([Product])],
})
export class ProductsModule {}
