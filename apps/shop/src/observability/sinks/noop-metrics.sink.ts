import { Injectable } from '@nestjs/common';

import { MetricEvent, MetricsSink } from '../metrics-sink';

@Injectable()
export class NoopMetricsSink implements MetricsSink {
  emit(event: MetricEvent): void {
    void event;
  }
}
