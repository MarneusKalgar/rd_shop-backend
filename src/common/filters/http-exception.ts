import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorResponse {
  message: string | string[];
  path: string;
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
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = this.extractStatus(exception);
    const message = this.extractMessage(exception);

    const errorResponse: ErrorResponse = {
      message: this.formatMessage(message),
      path: request.url,
      statusCode: status,
      timestamp: new Date().toISOString(),
    };

    this.logError(request, exception, status);

    response.status(status).json(errorResponse);
  }

  /**
   * Extracts the error message or response object from the exception.
   * @param exception - The exception that was thrown
   * @returns The error message string or response object
   */
  private extractMessage(exception: unknown): object | string {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      return typeof response === 'object' && 'message' in response
        ? (response as { message: string | string[] }).message
        : response;
    }
    return 'Internal server error';
  }

  /**
   * Extracts the HTTP status code from the exception.
   * @param exception - The exception that was thrown
   * @returns The HTTP status code
   */
  private extractStatus(exception: unknown): number {
    return exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
  }

  /**
   * Formats the message to extract the string value.
   * Handles strings, arrays, objects with message property, and plain objects.
   * @param message - The message string or object
   * @returns The formatted error message string or array of strings
   */
  private formatMessage(message: object | string): string | string[] {
    if (typeof message === 'string') {
      return message;
    }

    if (Array.isArray(message)) {
      // Handle arrays of strings or mixed types
      return message.map((item) => (typeof item === 'string' ? item : JSON.stringify(item)));
    }

    if (typeof message === 'object' && message !== null) {
      // Handle objects with 'message' property
      if ('message' in message) {
        const msg = (message as { message: string | string[] }).message;
        // Recursively handle if message property is also an array
        if (Array.isArray(msg)) {
          return msg;
        }
        return msg;
      }

      // Handle objects with 'error' property (common pattern)
      if ('error' in message && typeof (message as { error: unknown }).error === 'string') {
        return (message as { error: string }).error;
      }

      // For other objects, try to extract meaningful info or stringify
      const keys = Object.keys(message);
      if (keys.length > 0) {
        return JSON.stringify(message);
      }
    }

    return 'An error occurred';
  }

  /**
   * Logs the error with appropriate detail level based on status code.
   * Client errors (4xx) are logged without stack traces for performance.
   * Server errors (5xx) include full stack traces for debugging.
   * @param request - The Express request object
   * @param exception - The exception that was thrown
   * @param status - The HTTP status code
   */
  private logError(request: Request, exception: unknown, status: number): void {
    const logMessage = `${request.method} ${request.url} - Status: ${status}`;
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
