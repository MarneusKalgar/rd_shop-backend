import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

import { HEALTH_PATHS_TO_BYPASS } from '@/health/constants';

import { OBSERVABILITY_TRAFFIC_SOURCE_HEADER } from '../constants';
import { HttpMetricsService } from '../services/http-metrics.service';

@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly httpMetricsService: HttpMetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const startNs = process.hrtime.bigint();

    res.on('finish', () => {
      if (this.shouldSkip(req)) {
        return;
      }

      const trafficSourceHeader = req.headers[OBSERVABILITY_TRAFFIC_SOURCE_HEADER];
      const trafficSource = Array.isArray(trafficSourceHeader)
        ? trafficSourceHeader[0]
        : trafficSourceHeader;
      const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;

      this.httpMetricsService.recordRequest({
        durationMs,
        method: req.method,
        route: this.resolveRoute(req),
        statusCode: res.statusCode,
        trafficSource: trafficSource?.trim() ?? undefined,
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
