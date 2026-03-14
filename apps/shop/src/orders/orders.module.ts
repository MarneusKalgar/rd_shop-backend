import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PaymentsGrpcModule } from '@/payments/payments-grpc.module';
import { ProductsRepository } from '@/products/product.repository';
import { RabbitMQModule } from '@/rabbitmq/rabbitmq.module';

import { Product } from '../products/product.entity';
import { User } from '../users/user.entity';
import { OrderItem } from './order-item.entity';
import { Order } from './order.entity';
import { OrdersService } from './orders.service';
import { OrderItemsRepository, OrdersQueryBuilder, OrdersRepository } from './repositories';
import { OrdersController as OrdersControllerV1 } from './v1/orders.controller';

@Module({
  controllers: [OrdersControllerV1],
  exports: [OrdersService, OrdersRepository, OrderItemsRepository],
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, Product, User]),
    RabbitMQModule,
    PaymentsGrpcModule,
  ],
  providers: [
    OrdersService,
    OrdersRepository,
    ProductsRepository,
    OrderItemsRepository,
    OrdersQueryBuilder,
  ],
})
export class OrdersModule {}
