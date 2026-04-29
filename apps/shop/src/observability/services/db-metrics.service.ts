import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { METRICS_SINK, MetricsSink } from '../metrics-sink';
import { BaseMetricsService } from './base-metrics.service';

export const DB_METRICS_SERVICE = Symbol('DB_METRICS_SERVICE');

interface RecordRequestQueryCountArgs {
  queryCount: number;
  route: string;
  trafficSource?: string;
}

/**
 * Emits request-scoped database query volume metrics.
 *
 * This is fed by the existing AsyncLocalStorage query counter and helps surface
 * N+1 regressions or route-level query explosions without touching repository code.
 */
@Injectable()
export class DbMetricsService extends BaseMetricsService {
  constructor(
    @Inject(METRICS_SINK) protected readonly metricsSink: MetricsSink,
    protected readonly configService: ConfigService,
  ) {
    super(metricsSink, configService);
  }

  /**
   * Emits `DbQueriesPerRequest` for a resolved REST route.
   */
  recordRequestQueryCount({ queryCount, route, trafficSource }: RecordRequestQueryCountArgs): void {
    if (this.shouldSkip(trafficSource) || route === 'unmatched') {
      return;
    }

    this.metricsSink.emit({
      dimensions: {
        Environment: this.environment,
        Route: route,
        Service: this.serviceName,
      },
      metrics: [{ name: 'DbQueriesPerRequest', unit: 'Count', value: queryCount }],
    });
  }
}
