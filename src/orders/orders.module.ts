import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OrderItem } from './order-item.entity';
import { Order } from './order.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Order, OrderItem])],
})
export class OrdersModule {}
