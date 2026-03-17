import { Controller, Get, HttpStatus, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';

import {
  MinioHealthIndicator,
  PaymentsHealthIndicator,
  RabbitMQHealthIndicator,
} from './indicators';

@ApiTags('health')
@Controller({ version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly rabbitmq: RabbitMQHealthIndicator,
    private readonly payments: PaymentsHealthIndicator,
    private readonly minio: MinioHealthIndicator,
  ) {}

  @ApiOperation({
    description:
      'Checks the health of all dependent services: PostgreSQL, RabbitMQ, MinIO, and Payments (via gRPC).',
    summary: 'Application health check',
  })
  @ApiResponse({
    description: 'All services are healthy',
    schema: {
      example: {
        details: {
          minio: { status: 'up' },
          payments: { status: 'up' },
          postgres: { status: 'up' },
          rabbitmq: { status: 'up' },
        },
        error: {},
        info: {
          minio: { status: 'up' },
          payments: { status: 'up' },
          postgres: { status: 'up' },
          rabbitmq: { status: 'up' },
        },
        status: 'ok',
      },
    },
    status: HttpStatus.OK,
  })
  @ApiResponse({
    description: 'One or more services are unhealthy',
    schema: {
      example: {
        details: {
          minio: { status: 'up' },
          payments: { status: 'down' },
          postgres: { status: 'up' },
          rabbitmq: { status: 'up' },
        },
        error: {
          payments: { status: 'down' },
        },
        info: {
          minio: { status: 'up' },
          postgres: { status: 'up' },
          rabbitmq: { status: 'up' },
        },
        status: 'error',
      },
    },
    status: HttpStatus.SERVICE_UNAVAILABLE,
  })
  @Get('health')
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck('postgres'),
      () => this.rabbitmq.check('rabbitmq'),
      () => this.minio.check('minio'),
      () => this.payments.check('payments'),
    ]);
  }
}
