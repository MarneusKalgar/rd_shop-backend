import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

import { getNewStore, requestContext } from '@/core/async-storage';

/**
 * Middleware that logs the query count for each request
 */
@Injectable()
export class QueryLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger(QueryLoggerMiddleware.name);

  use(req: Request, res: Response, next: NextFunction): void {
    const store = getNewStore();

    requestContext.run(store, () => {
      res.on('finish', () => {
        if (!req.originalUrl.startsWith('/graphql')) return;

        const msg = `SQL Queries: ${store.queryCount}`;
        this.logger.log(msg);
      });

      next();
    });
  }
}
