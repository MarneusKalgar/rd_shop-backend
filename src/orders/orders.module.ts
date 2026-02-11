import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Product } from '../products/product.entity';
import { User } from '../users/user.entity';
import { OrderItem } from './order-item.entity';
import { Order } from './order.entity';
import { OrdersService } from './orders.service';
import { OrdersController as OrdersControllerV1 } from './v1/orders.controller';

@Module({
  controllers: [OrdersControllerV1],
  imports: [TypeOrmModule.forFeature([Order, OrderItem, Product, User])],
  providers: [OrdersService],
})
export class OrdersModule {}
