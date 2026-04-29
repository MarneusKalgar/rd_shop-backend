import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { METRICS_SINK, MetricsSink } from '../metrics-sink';
import { BaseMetricsService } from './base-metrics.service';

export type WorkerMetricResult = 'dlq' | 'retry' | 'success';

interface RecordOrderProcessingDurationArgs {
  durationMs: number;
  result: WorkerMetricResult;
  trafficSource?: string;
}

interface RecordRabbitMqPublishArgs {
  queue: string;
  trafficSource?: string;
}

interface RecordWorkerMessageArgs {
  queue: string;
  result: WorkerMetricResult;
  trafficSource?: string;
}

/**
 * Emits queue and worker execution metrics for async order processing.
 *
 * It covers queue publish volume, worker outcomes, and end-to-end handler duration.
 */
@Injectable()
export class WorkerMetricsService extends BaseMetricsService {
  constructor(
    @Inject(METRICS_SINK) protected readonly metricsSink: MetricsSink,
    protected readonly configService: ConfigService,
  ) {
    super(metricsSink, configService);
  }

  /**
   * Emits `OrderProcessingDurationMs` for a processed worker message.
   */
  recordOrderProcessingDuration({
    durationMs,
    result,
    trafficSource,
  }: RecordOrderProcessingDurationArgs): void {
    if (this.shouldSkip(trafficSource)) {
      return;
    }

    this.metricsSink.emit({
      dimensions: {
        Environment: this.environment,
        Result: result,
        Service: this.serviceName,
      },
      metrics: [{ name: 'OrderProcessingDurationMs', unit: 'Milliseconds', value: durationMs }],
    });
  }

  /**
   * Emits `RabbitMqPublishCount` for a logical queue publish.
   */
  recordRabbitMqPublish({ queue, trafficSource }: RecordRabbitMqPublishArgs): void {
    if (this.shouldSkip(trafficSource)) {
      return;
    }

    this.metricsSink.emit({
      dimensions: {
        Environment: this.environment,
        Queue: queue,
        Service: this.serviceName,
      },
      metrics: [{ name: 'RabbitMqPublishCount', unit: 'Count', value: 1 }],
    });
  }

  /**
   * Emits `OrderWorkerMessageCount` for the final worker outcome.
   */
  recordWorkerMessage({ queue, result, trafficSource }: RecordWorkerMessageArgs): void {
    if (this.shouldSkip(trafficSource)) {
      return;
    }

    this.metricsSink.emit({
      dimensions: {
        Environment: this.environment,
        Queue: queue,
        Result: result,
        Service: this.serviceName,
      },
      metrics: [{ name: 'OrderWorkerMessageCount', unit: 'Count', value: 1 }],
    });
  }
}
