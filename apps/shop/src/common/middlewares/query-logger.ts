import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';

import { getNewStore, requestContext } from '@/core/async-storage';
import { OBSERVABILITY_TRAFFIC_SOURCE_HEADER } from '@/observability/constants';

/**
 * Middleware that logs the query count for each request
 */
@Injectable()
export class QueryLoggerMiddleware implements NestMiddleware {
  constructor(private readonly logger: PinoLogger) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const trafficSourceHeader = req.headers[OBSERVABILITY_TRAFFIC_SOURCE_HEADER];
    const trafficSource = Array.isArray(trafficSourceHeader)
      ? trafficSourceHeader[0]
      : trafficSourceHeader;
    const store = getNewStore(trafficSource?.trim() ?? undefined);

    requestContext.run(store, () => {
      res.on('finish', () => {
        if (!req.originalUrl.startsWith('/graphql')) return;

        this.logger.info({ queryCount: store.queryCount }, `SQL Queries: ${store.queryCount}`);
      });

      next();
    });
  }
}
