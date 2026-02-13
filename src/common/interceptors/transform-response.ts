import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Standard response wrapper interface.
 * @template T - The type of the data payload
 * @property data - The response data payload
 * @todo Extend in the future to include metadata, pagination, etc.
 */
export type Response<T> = Record<string, number | string | T>;

export interface ServiceResponse<T> {
  data: Record<string, number | string | T>;
}

/**
 * Interceptor that transforms all responses to a standardized format.
 * Wraps the response data in a `Response<T>` object with a `data` property.
 * @template T - The type of the response data
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, Response<T>> {
  /**
   * Intercepts the response and transforms it to the standard format.
   * @param context - The execution context of the request
   * @param next - The call handler to proceed with the request
   * @returns An observable of the transformed response
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<Response<T>> {
    return next.handle().pipe(
      map((data: Response<T>) => {
        if ('items' in data) {
          const { items, ...rest } = data;
          return {
            data: items,
            ...rest,
          };
        }

        return data;
      }),
    );
  }
}
