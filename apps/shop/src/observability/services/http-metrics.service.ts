import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { METRICS_SINK, MetricsSink } from '../metrics-sink';

interface RecordHttpRequestArgs {
  durationMs: number;
  method: string;
  route: string;
  statusCode: number;
}

/**
 * Emits REST request metrics for the shop service.
 *
 * The middleware resolves normalized route keys and status codes, while this
 * service translates them into low-cardinality EMF events.
 */
@Injectable()
export class HttpMetricsService {
  private readonly environment: string;
  private readonly serviceName: string;

  constructor(
    @Inject(METRICS_SINK) protected readonly metricsSink: MetricsSink,
    protected readonly configService: ConfigService,
  ) {
    this.environment =
      this.configService.get<string>('DEPLOYMENT_ENVIRONMENT') ??
      this.configService.get<string>('NODE_ENV') ??
      'unknown';
    this.serviceName = this.configService.get<string>('APP') ?? 'shop';
  }

  /**
   * Emits request count and duration metrics for a single REST response.
   */
  recordRequest({ durationMs, method, route, statusCode }: RecordHttpRequestArgs): void {
    const baseDimensions = {
      Environment: this.environment,
      Method: method.toUpperCase(),
      Route: route,
      Service: this.serviceName,
    };

    this.metricsSink.emit({
      dimensions: {
        ...baseDimensions,
        StatusClass: `${Math.floor(statusCode / 100)}xx`,
      },
      metrics: [{ name: 'HttpRequestCount', unit: 'Count', value: 1 }],
      properties: { statusCode },
    });

    this.metricsSink.emit({
      dimensions: baseDimensions,
      metrics: [{ name: 'HttpRequestDurationMs', unit: 'Milliseconds', value: durationMs }],
      properties: { statusCode },
    });
  }
}
