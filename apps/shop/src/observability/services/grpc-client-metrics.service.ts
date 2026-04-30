import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { METRICS_SINK, MetricsSink } from '../metrics-sink';
import { BaseMetricsService } from './base-metrics.service';

export type GrpcClientOutcome = 'error' | 'success' | 'timeout';

interface RecordGrpcClientDurationArgs {
  durationMs: number;
  method: string;
  peerService: string;
}

interface RecordGrpcClientRequestArgs {
  method: string;
  outcome: GrpcClientOutcome;
  peerService: string;
}

/**
 * Emits outbound gRPC client metrics for shop-to-service calls.
 *
 * This service keeps the transport-specific metric vocabulary in one place so
 * higher-level clients only report semantic method, peer, outcome, and duration.
 */
@Injectable()
export class GrpcClientMetricsService extends BaseMetricsService {
  constructor(
    @Inject(METRICS_SINK) protected readonly metricsSink: MetricsSink,
    protected readonly configService: ConfigService,
  ) {
    super(metricsSink, configService);
  }

  /**
   * Emits `GrpcClientDurationMs` for one outbound client request.
   */
  recordDuration({ durationMs, method, peerService }: RecordGrpcClientDurationArgs): void {
    this.metricsSink.emit({
      dimensions: {
        Environment: this.environment,
        Method: method,
        PeerService: peerService,
        Service: this.serviceName,
      },
      metrics: [{ name: 'GrpcClientDurationMs', unit: 'Milliseconds', value: durationMs }],
    });
  }

  /**
   * Emits `GrpcClientRequestCount` for one outbound client outcome.
   */
  recordRequest({ method, outcome, peerService }: RecordGrpcClientRequestArgs): void {
    this.metricsSink.emit({
      dimensions: {
        Environment: this.environment,
        Method: method,
        Outcome: outcome,
        PeerService: peerService,
        Service: this.serviceName,
      },
      metrics: [{ name: 'GrpcClientRequestCount', unit: 'Count', value: 1 }],
    });
  }
}
