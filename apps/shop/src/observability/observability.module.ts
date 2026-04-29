import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { METRICS_SINK } from './metrics-sink';
import { HttpMetricsMiddleware } from './middleware/http-metrics.middleware';
import { DB_METRICS_SERVICE, DbMetricsService } from './services/db-metrics.service';
import { HttpMetricsService } from './services/http-metrics.service';
import { OrdersMetricsService } from './services/orders-metrics.service';
import { WorkerMetricsService } from './services/worker-metrics.service';
import { CloudWatchEmfMetricsSink, NoopMetricsSink } from './sinks';
import { shouldEnableObservabilityMetrics } from './utils';

@Module({
  exports: [
    DB_METRICS_SERVICE,
    DbMetricsService,
    HttpMetricsMiddleware,
    HttpMetricsService,
    METRICS_SINK,
    OrdersMetricsService,
    WorkerMetricsService,
  ],
  providers: [
    CloudWatchEmfMetricsSink,
    NoopMetricsSink,
    DbMetricsService,
    {
      provide: DB_METRICS_SERVICE,
      useExisting: DbMetricsService,
    },
    HttpMetricsService,
    HttpMetricsMiddleware,
    OrdersMetricsService,
    WorkerMetricsService,
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
