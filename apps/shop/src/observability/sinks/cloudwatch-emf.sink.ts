import { Injectable } from '@nestjs/common';

import { OBSERVABILITY_METRICS_NAMESPACE } from '../constants';
import { MetricEvent, MetricsSink } from '../metrics-sink';

@Injectable()
export class CloudWatchEmfMetricsSink implements MetricsSink {
  emit(event: MetricEvent): void {
    const metricValues = Object.fromEntries(
      event.metrics.map((metric) => [metric.name, metric.value]),
    );

    const payload = {
      _aws: {
        CloudWatchMetrics: [
          {
            Dimensions: [Object.keys(event.dimensions)],
            Metrics: event.metrics.map((metric) => ({ Name: metric.name, Unit: metric.unit })),
            Namespace: OBSERVABILITY_METRICS_NAMESPACE,
          },
        ],
        Timestamp: event.timestamp ?? Date.now(),
      },
      ...event.dimensions,
      ...metricValues,
      ...event.properties,
    };

    process.stdout.write(`${JSON.stringify(payload)}\n`);
  }
}
