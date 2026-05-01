import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

import { getRequestContext } from '@/core/async-storage';
import { HEALTH_PATHS_TO_BYPASS } from '@/health/constants';

import { DB_METRICS_SERVICE } from '../services/db-metrics.service';
import { HttpMetricsService } from '../services/http-metrics.service';

/**
 * Narrow DI contract for the DB metrics emitter used by the HTTP middleware.
 */
interface DbMetricsRecorder {
  recordRequestQueryCount(args: { queryCount: number; route: string }): void;
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

      const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
      const route = this.resolveRoute(req);

      this.httpMetricsService.recordRequest({
        durationMs,
        method: req.method,
        route,
        statusCode: res.statusCode,
      });

      this.dbMetricsService.recordRequestQueryCount({
        queryCount: requestContext?.queryCount ?? 0,
        route,
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
