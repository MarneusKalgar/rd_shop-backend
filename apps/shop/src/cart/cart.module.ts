import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OrdersModule } from '@/orders/orders.module';
import { ProductsRepository } from '@/products/product.repository';

import { Product } from '../products/product.entity';
import { CartItem } from './cart-item.entity';
import { Cart } from './cart.entity';
import { CartService } from './cart.service';
import { CartController } from './v1/cart.controller';

@Module({
  controllers: [CartController],
  imports: [TypeOrmModule.forFeature([Cart, CartItem, Product]), OrdersModule],
  providers: [CartService, ProductsRepository],
})
export class CartModule {}
