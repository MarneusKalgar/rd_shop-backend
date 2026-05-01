import { ConfigService } from '@nestjs/config';

import { MetricsSink } from '../metrics-sink';

/**
 * Shared observability service base.
 *
 * Resolves the common CloudWatch metric dimensions once.
 */
export abstract class BaseMetricsService {
  protected readonly environment: string;
  protected readonly serviceName: string;

  protected constructor(
    protected readonly metricsSink: MetricsSink,
    protected readonly configService: ConfigService,
  ) {
    this.environment =
      this.configService.get<string>('DEPLOYMENT_ENVIRONMENT') ??
      this.configService.get<string>('NODE_ENV') ??
      'unknown';
    this.serviceName = this.configService.get<string>('APP') ?? 'shop';
  }
}
