import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogModule } from '@/audit-log';
import { MailModule } from '@/mail/mail.module';
import { PaymentsGrpcModule } from '@/payments/payments-grpc.module';
import { ProductsRepository } from '@/products/product.repository';
import { RabbitMQModule } from '@/rabbitmq/rabbitmq.module';

import { Product } from '../products/product.entity';
import { User } from '../users/user.entity';
import { OrderEmailListener } from './order-email.listener';
import { OrderItem } from './order-item.entity';
import { Order } from './order.entity';
import { OrdersService } from './orders.service';
import { OrderItemsRepository, OrdersQueryBuilder, OrdersRepository } from './repositories';
import { OrdersQueryService, OrderStockService } from './services';
import { OrdersController as OrdersControllerV1 } from './v1/orders.controller';

@Module({
  controllers: [OrdersControllerV1],
  exports: [OrdersService, OrdersRepository, OrderItemsRepository],
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, Product, User]),
    AuditLogModule,
    EventEmitterModule.forRoot(),
    MailModule,
    RabbitMQModule,
    PaymentsGrpcModule,
  ],
  providers: [
    OrdersService,
    OrderStockService,
    OrdersQueryService,
    OrdersRepository,
    ProductsRepository,
    OrderItemsRepository,
    OrdersQueryBuilder,
    OrderEmailListener,
  ],
})
export class OrdersModule {}
