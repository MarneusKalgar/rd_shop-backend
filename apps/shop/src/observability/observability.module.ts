import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { METRICS_SINK } from './metrics-sink';
import { HttpMetricsMiddleware } from './middleware/http-metrics.middleware';
import { HttpMetricsService } from './services/http-metrics.service';
import { CloudWatchEmfMetricsSink, NoopMetricsSink } from './sinks';
import { shouldEnableObservabilityMetrics } from './utils';

@Module({
  exports: [HttpMetricsMiddleware, HttpMetricsService, METRICS_SINK],
  providers: [
    CloudWatchEmfMetricsSink,
    NoopMetricsSink,
    HttpMetricsService,
    HttpMetricsMiddleware,
    {
      inject: [ConfigService, CloudWatchEmfMetricsSink, NoopMetricsSink],
      provide: METRICS_SINK,
      useFactory: (
        configService: ConfigService,
        cloudWatchSink: CloudWatchEmfMetricsSink,
        noopSink: NoopMetricsSink,
      ) => (shouldEnableObservabilityMetrics(configService) ? cloudWatchSink : noopSink),
    },
  ],
})
export class ObservabilityModule {}
