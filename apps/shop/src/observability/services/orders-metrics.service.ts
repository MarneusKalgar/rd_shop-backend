import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { METRICS_SINK, MetricsSink } from '../metrics-sink';
import { BaseMetricsService } from './base-metrics.service';

interface RecordOrderCompletionArgs {
  finalStatus: string;
}

interface RecordOrderCreatedArgs {
  initialStatus: string;
}

/**
 * Emits business-level order lifecycle metrics.
 *
 * This service stays close to semantic order transitions and does not know
 * about transport or CloudWatch payload details beyond the shared sink contract.
 */
@Injectable()
export class OrdersMetricsService extends BaseMetricsService {
  constructor(
    @Inject(METRICS_SINK) protected readonly metricsSink: MetricsSink,
    protected readonly configService: ConfigService,
  ) {
    super(metricsSink, configService);
  }

  /**
   * Emits `OrderCompletionCount` for a terminal order state.
   */
  recordOrderCompleted({ finalStatus }: RecordOrderCompletionArgs): void {
    this.metricsSink.emit({
      dimensions: {
        Environment: this.environment,
        FinalStatus: finalStatus,
        Service: this.serviceName,
      },
      metrics: [{ name: 'OrderCompletionCount', unit: 'Count', value: 1 }],
    });
  }

  /**
   * Emits `OrderCreatedCount` after a new order is committed.
   */
  recordOrderCreated({ initialStatus }: RecordOrderCreatedArgs): void {
    this.metricsSink.emit({
      dimensions: {
        Environment: this.environment,
        InitialStatus: initialStatus,
        Service: this.serviceName,
      },
      metrics: [{ name: 'OrderCreatedCount', unit: 'Count', value: 1 }],
    });
  }
}
