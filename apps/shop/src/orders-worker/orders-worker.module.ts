import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ObservabilityModule } from '@/observability';
import { Order } from '@/orders/order.entity';
import { OrdersModule } from '@/orders/orders.module';
import { ProcessedMessage } from '@/rabbitmq/processed-message.entity';
import { RabbitMQModule } from '@/rabbitmq/rabbitmq.module';

import { OrderWorkerService } from './orders-worker.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, ProcessedMessage]),
    RabbitMQModule,
    OrdersModule,
    ObservabilityModule,
  ],
  providers: [OrderWorkerService],
})
export class OrderWorkerModule {}
