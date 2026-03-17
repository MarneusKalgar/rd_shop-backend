import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { PaymentsGrpcModule } from '@/payments/payments-grpc.module';

import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
import { HealthController } from './health.controller';
import { PaymentsHealthIndicator } from './payments.health';
import { RabbitMQHealthIndicator } from './rabbitmq.health';

@Module({
  controllers: [HealthController],
  imports: [TerminusModule, RabbitMQModule, PaymentsGrpcModule],
  providers: [RabbitMQHealthIndicator, PaymentsHealthIndicator],
})
export class HealthModule {}
