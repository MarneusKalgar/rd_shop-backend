import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Response } from 'express';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';

/**
 * Sets the X-Response-Time header on HTTP responses.
 * Measures wall-clock time using process.hrtime.bigint() for nanosecond precision.
 * Skips non-HTTP contexts (e.g. GraphQL, gRPC, RabbitMQ).
 */
@Injectable()
export class ResponseTimeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const response = context.switchToHttp().getResponse<Response>();
    const startNs = process.hrtime.bigint();

    return next.handle().pipe(
      finalize(() => {
        if (response.headersSent) return;
        const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
        response.setHeader('X-Response-Time', `${durationMs.toFixed(2)}ms`);
      }),
    );
  }
}
