import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { RabbitMQService } from './rabbitmq.service';

@Module({
  exports: [RabbitMQService],
  imports: [ConfigModule],
  providers: [RabbitMQService],
})
export class RabbitMQModule {}
