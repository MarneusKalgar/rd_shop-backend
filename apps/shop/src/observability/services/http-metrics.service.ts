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
    const serviceDimensions = {
      Environment: this.environment,
      Service: this.serviceName,
    };
    const statusClass = `${Math.floor(statusCode / 100)}xx`;

    this.metricsSink.emit({
      dimensions: {
        ...baseDimensions,
        StatusClass: statusClass,
      },
      metrics: [{ name: 'HttpRequestCount', unit: 'Count', value: 1 }],
      properties: { statusCode },
    });

    this.metricsSink.emit({
      dimensions: serviceDimensions,
      metrics: [{ name: 'HttpRequestCount', unit: 'Count', value: 1 }],
      properties: { statusCode },
    });

    this.metricsSink.emit({
      dimensions: {
        ...serviceDimensions,
        StatusClass: statusClass,
      },
      metrics: [{ name: 'HttpRequestCount', unit: 'Count', value: 1 }],
      properties: { statusCode },
    });

    this.metricsSink.emit({
      dimensions: baseDimensions,
      metrics: [{ name: 'HttpRequestDurationMs', unit: 'Milliseconds', value: durationMs }],
      properties: { statusCode },
    });

    this.metricsSink.emit({
      dimensions: serviceDimensions,
      metrics: [{ name: 'HttpRequestDurationMs', unit: 'Milliseconds', value: durationMs }],
      properties: { statusCode },
    });
  }
}
