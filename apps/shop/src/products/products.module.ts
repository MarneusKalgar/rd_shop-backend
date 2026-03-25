import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FilesModule } from '../files/files.module';
import { Product } from './product.entity';
import { ProductsRepository } from './product.repository';
import { ProductsService } from './products.service';
import { AdminProductsController } from './v1/admin-products.controller';
import { ProductsController } from './v1/products.controller';

@Module({
  controllers: [ProductsController, AdminProductsController],
  exports: [TypeOrmModule, ProductsService, ProductsRepository],
  imports: [TypeOrmModule.forFeature([Product]), forwardRef(() => FilesModule)],
  providers: [ProductsService, ProductsRepository],
})
export class ProductsModule {}
