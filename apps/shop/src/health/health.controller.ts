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
    private readonly healthCheckService: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly rabbitmq: RabbitMQHealthIndicator,
    private readonly payments: PaymentsHealthIndicator,
    private readonly minio: MinioHealthIndicator,
  ) {}

  @ApiOperation({
    description: 'Lightweight liveness probe. Returns 200 if the process is running.',
    summary: 'Liveness check',
  })
  @ApiResponse({
    description: 'Application is alive',
    schema: {
      example: {
        details: {},
        error: {},
        info: {},
        status: 'ok',
      },
    },
    status: HttpStatus.OK,
  })
  @Get('health')
  @HealthCheck()
  health() {
    return this.healthCheckService.check([]);
  }

  @ApiOperation({
    description:
      'Readiness probe. Checks hard dependencies only: PostgreSQL, RabbitMQ, MinIO. If any of these are down the app cannot serve traffic.',
    summary: 'Readiness check',
  })
  @ApiResponse({
    description: 'All hard dependencies are healthy',
    schema: {
      example: {
        details: {
          minio: { status: 'up' },
          postgres: { status: 'up' },
          rabbitmq: { status: 'up' },
        },
        error: {},
        info: { minio: { status: 'up' }, postgres: { status: 'up' }, rabbitmq: { status: 'up' } },
        status: 'ok',
      },
    },
    status: HttpStatus.OK,
  })
  @ApiResponse({
    description: 'One or more hard dependencies are unhealthy',
    schema: {
      example: {
        details: {
          minio: { status: 'down' },
          postgres: { status: 'up' },
          rabbitmq: { status: 'up' },
        },
        error: { minio: { status: 'down' } },
        info: { postgres: { status: 'up' }, rabbitmq: { status: 'up' } },
        status: 'error',
      },
    },
    status: HttpStatus.SERVICE_UNAVAILABLE,
  })
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.healthCheckService.check([
      () => this.db.pingCheck('postgres'),
      () => this.rabbitmq.check('rabbitmq'),
      () => this.minio.check('minio'),
    ]);
  }

  @ApiOperation({
    description:
      'Full status including soft dependencies. Always returns 200 — check the body for individual service states.',
    summary: 'Full status',
  })
  @ApiResponse({
    description: 'Status of all services including soft dependencies',
    schema: {
      example: {
        details: {
          minio: { status: 'up' },
          payments: { status: 'down' },
          postgres: { status: 'up' },
          rabbitmq: { status: 'up' },
        },
        error: { payments: { status: 'down' } },
        info: { minio: { status: 'up' }, postgres: { status: 'up' }, rabbitmq: { status: 'up' } },
        status: 'error',
      },
    },
    status: HttpStatus.OK,
  })
  @Get('status')
  async status() {
    try {
      return await this.healthCheckService.check([
        () => this.db.pingCheck('postgres'),
        () => this.rabbitmq.check('rabbitmq'),
        () => this.minio.check('minio'),
        () => this.payments.check('payments'),
      ]);
    } catch (error: unknown) {
      // Return the Terminus error body as-is with 200 so soft-dep failures
      // are visible without causing a 503
      return (error as { response: unknown }).response ?? error;
    }
  }
}
