import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

import { REQUEST_ID_HEADER } from '../constants';

// TODO register globally
export type RequestWithId = Request & { requestId: string };

/**
 * Middleware that adds X-Request-ID header to requests and responses for tracing.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  /**
   * Adds or uses existing X-Request-ID header for request tracing.
   * @param req - Express request object
   * @param res - Express response object
   * @param next - Express next function
   */
  use(req: RequestWithId, res: Response, next: NextFunction): void {
    const requestId = (req.headers[REQUEST_ID_HEADER] as string) || randomUUID();

    // Add request ID to request headers for tracing
    req.headers[REQUEST_ID_HEADER] = requestId;

    req.requestId = requestId;

    // Add request ID to response headers
    res.setHeader('X-Request-ID', requestId);

    next();
  }
}
