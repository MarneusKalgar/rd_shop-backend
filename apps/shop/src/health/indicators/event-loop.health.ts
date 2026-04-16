import { Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import { eventLoopState } from '@/core/event-loop-monitor';

@Injectable()
export class EventLoopHealthIndicator {
  constructor(private readonly healthIndicatorService: HealthIndicatorService) {}

  check(key = 'event_loop'): HealthIndicatorResult {
    const { p99Ms, thresholdMs } = eventLoopState;
    const indicator = this.healthIndicatorService.check(key);
    const isHealthy = thresholdMs === 0 || p99Ms <= thresholdMs;
    const data = { p99Ms: Math.round(p99Ms), thresholdMs };
    return isHealthy ? indicator.up(data) : indicator.down(data);
  }
}
