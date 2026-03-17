import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';

import { PaymentsHealthIndicator } from './payments.health';
import { RabbitMQHealthIndicator } from './rabbitmq.health';

@Controller({ version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly rabbitmq: RabbitMQHealthIndicator,
    private readonly payments: PaymentsHealthIndicator,
  ) {}

  @Get('health')
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck('postgres'),
      () => this.rabbitmq.check('rabbitmq'),
      () => this.payments.check('payments'),
    ]);
  }
}
