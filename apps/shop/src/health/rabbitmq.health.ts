import { Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import { RabbitMQService } from '../rabbitmq/rabbitmq.service';

@Injectable()
export class RabbitMQHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly rabbitMQService: RabbitMQService,
  ) {}

  check(key = 'rabbitmq'): HealthIndicatorResult {
    const indicator = this.healthIndicatorService.check(key);
    const connection = this.rabbitMQService.connection;
    const channel = this.rabbitMQService.channel;

    if (connection && channel) {
      return indicator.up();
    }

    return indicator.down();
  }
}
