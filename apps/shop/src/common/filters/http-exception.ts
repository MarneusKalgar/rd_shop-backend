import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { GqlArgumentsHost, GqlContextType } from '@nestjs/graphql';
import { Request, Response } from 'express';
import { GraphQLError } from 'graphql';

import { extractRequestIdFromGraphQL, normalizeGQLError } from './utils/gql';
import { extractMessage, extractRequestId, extractStatus, formatMessage } from './utils/http';

export interface GraphQLContext {
  req?: Request;
}

interface ErrorResponse {
  message: string | string[];
  path: string;
  requestId?: string;
  statusCode: number;
  timestamp: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  /**
   * Global exception filter that catches all exceptions and formats them consistently.
   * Uses lightweight logging for expected errors (4xx) and detailed logging for unexpected errors (5xx).
   */
  catch(exception: unknown, host: ArgumentsHost) {
    const contextType = host.getType<GqlContextType>();
    if (contextType === 'graphql') {
      return this.handleGraphQLException(exception, host);
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = extractStatus(exception);
    const message = extractMessage(exception);
    const requestId = extractRequestId(request);

    const errorResponse: ErrorResponse = {
      message: formatMessage(message),
      path: request.url,
      requestId,
      statusCode: status,
      timestamp: new Date().toISOString(),
    };

    this.logHttpError(request, exception, status);

    response.status(status).json(errorResponse);
  }

  private handleGraphQLException(exception: unknown, host: ArgumentsHost) {
    const gqlHost = GqlArgumentsHost.create(host);
    const ctx = gqlHost.getContext<GraphQLContext>();
    const requestId = extractRequestIdFromGraphQL(ctx);

    const errorResponse = normalizeGQLError(exception);

    this.logGraphQLError(errorResponse, exception, requestId);

    throw new GraphQLError(errorResponse.message, {
      extensions: {
        code: errorResponse.code,
        requestId,
        ...errorResponse.extensions,
      },
    });
  }

  /**
   * Logs GraphQL errors with appropriate detail level based on status code.
   * Client errors (4xx) are logged without stack traces for performance.
   * Server errors (5xx) include full stack traces for debugging.
   */
  private logGraphQLError(
    errorResponse: { code: string; message: string; statusCode: number },
    exception: unknown,
    requestId: string,
  ): void {
    const logMessage = `GraphQL ${errorResponse.code}: ${errorResponse.message} | RequestID: ${requestId}`;
    const isError = exception instanceof Error;

    if (errorResponse.statusCode >= 500) {
      // Server errors: log with full stack trace
      this.logger.error(logMessage, isError ? exception.stack : exception);
    } else {
      // Client errors: lightweight logging without stack trace
      const errorMessage = isError ? exception.message : String(exception);
      this.logger.warn(`${logMessage} - ${errorMessage}`);
    }
  }

  /**
   * Logs HTTP errors with appropriate detail level based on status code.
   * Client errors (4xx) are logged without stack traces for performance.
   * Server errors (5xx) include full stack traces for debugging.
   */
  private logHttpError(request: Request, exception: unknown, status: number): void {
    const logMessage = `HTTP ${request.method} ${request.url} - Status: ${status}`;
    const isError = exception instanceof Error;

    if (status >= 500) {
      // Server errors: log with full stack trace
      this.logger.error(logMessage, isError ? exception.stack : exception);
    } else {
      // Client errors: lightweight logging without stack trace
      const errorMessage = isError ? exception.message : String(exception);
      this.logger.warn(`${logMessage} - ${errorMessage}`);
    }
  }
}
