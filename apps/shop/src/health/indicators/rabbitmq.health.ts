import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import { ORDER_PROCESS_QUEUE } from '@/rabbitmq/constants';
import { RabbitMQService } from '@/rabbitmq/rabbitmq.service';

@Injectable()
export class RabbitMQHealthIndicator {
  private readonly logger = new Logger(RabbitMQHealthIndicator.name);

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly rabbitMQService: RabbitMQService,
  ) {}

  async check(key = 'rabbitmq'): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    const channel = this.rabbitMQService.channel;

    if (!channel) {
      this.logger.warn('RabbitMQ channel is not initialized');
      return indicator.down();
    }

    try {
      await channel.checkQueue(ORDER_PROCESS_QUEUE);
      return indicator.up();
    } catch (error) {
      this.logger.error('RabbitMQ health check failed', error);
      return indicator.down();
    }
  }
}
