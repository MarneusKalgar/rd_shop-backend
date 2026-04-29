import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

import { getRequestContext } from '@/core/async-storage';
import { HEALTH_PATHS_TO_BYPASS } from '@/health/constants';

import { OBSERVABILITY_TRAFFIC_SOURCE_HEADER } from '../constants';
import { DB_METRICS_SERVICE } from '../services/db-metrics.service';
import { HttpMetricsService } from '../services/http-metrics.service';

/**
 * Narrow DI contract for the DB metrics emitter used by the HTTP middleware.
 */
interface DbMetricsRecorder {
  recordRequestQueryCount(args: {
    queryCount: number;
    route: string;
    trafficSource?: string;
  }): void;
}

@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(
    private readonly httpMetricsService: HttpMetricsService,
    @Inject(DB_METRICS_SERVICE)
    private readonly dbMetricsService: DbMetricsRecorder,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const startNs = process.hrtime.bigint();
    const requestContext = getRequestContext();

    res.on('finish', () => {
      if (this.shouldSkip(req)) {
        return;
      }

      const trafficSourceHeader = req.headers[OBSERVABILITY_TRAFFIC_SOURCE_HEADER];
      const rawTrafficSource = Array.isArray(trafficSourceHeader)
        ? trafficSourceHeader[0]
        : trafficSourceHeader;
      const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
      const route = this.resolveRoute(req);
      const trafficSource = requestContext?.trafficSource ?? rawTrafficSource?.trim() ?? undefined;

      this.httpMetricsService.recordRequest({
        durationMs,
        method: req.method,
        route,
        statusCode: res.statusCode,
        trafficSource,
      });

      this.dbMetricsService.recordRequestQueryCount({
        queryCount: requestContext?.queryCount ?? 0,
        route,
        trafficSource,
      });
    });

    next();
  }

  private hasStringPath(route: unknown): route is { path: string } {
    if (!route || typeof route !== 'object') {
      return false;
    }

    return typeof (route as Record<string, unknown>).path === 'string';
  }

  private resolveRoute(req: Request): string {
    const route = (req as unknown as { route?: unknown }).route;

    if (!this.hasStringPath(route)) {
      return 'unmatched';
    }

    return `${req.baseUrl}${route.path}`.replace(/\/+/g, '/');
  }

  private shouldSkip(req: Request): boolean {
    if (req.method.toUpperCase() === 'OPTIONS') {
      return true;
    }

    if (req.path.startsWith('/graphql')) {
      return true;
    }

    return HEALTH_PATHS_TO_BYPASS.some((path) => req.path.startsWith(path));
  }
}
