import { Logger } from 'nestjs-pino';
import { monitorEventLoopDelay } from 'node:perf_hooks';

/**
 * Module-level state updated every sampling interval.
 * Read by EventLoopHealthIndicator without DI coupling.
 */
export const eventLoopState = { p99Ms: 0, thresholdMs: 0 };

/**
 * Starts a periodic event-loop-lag monitor.
 * Every 5 seconds it samples p50, p95, and p99 delay from the internal histogram.
 * Logs a structured warning whenever p99 exceeds the configured threshold.
 * The interval is unref'd so it never prevents process exit.
 *
 * Resolution is set to 20 ms — a good balance between accuracy and overhead.
 */
export function setupEventLoopMonitoring(logger: Logger, thresholdMs: number): void {
  eventLoopState.thresholdMs = thresholdMs;

  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();

  setInterval(() => {
    const p50Ms = histogram.percentile(50) / 1_000_000;
    const p95Ms = histogram.percentile(95) / 1_000_000;
    const p99Ms = histogram.percentile(99) / 1_000_000;

    histogram.reset();

    eventLoopState.p99Ms = p99Ms;

    if (p99Ms > thresholdMs) {
      logger.warn(
        `Event loop lag exceeded threshold — p50=${p50Ms.toFixed(2)}ms p95=${p95Ms.toFixed(2)}ms p99=${p99Ms.toFixed(2)}ms (threshold=${thresholdMs}ms)`,
        'EventLoopMonitor',
      );
    }
  }, 5_000).unref();
}
