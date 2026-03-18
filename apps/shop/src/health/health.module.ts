import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { FilesModule } from '@/files/files.module';
import { PaymentsGrpcModule } from '@/payments/payments-grpc.module';
import { RabbitMQModule } from '@/rabbitmq/rabbitmq.module';

import { HealthController } from './health.controller';
import {
  MinioHealthIndicator,
  PaymentsHealthIndicator,
  RabbitMQHealthIndicator,
} from './indicators';

@Module({
  controllers: [HealthController],
  imports: [TerminusModule, RabbitMQModule, PaymentsGrpcModule, FilesModule],
  providers: [RabbitMQHealthIndicator, PaymentsHealthIndicator, MinioHealthIndicator],
})
export class HealthModule {}
