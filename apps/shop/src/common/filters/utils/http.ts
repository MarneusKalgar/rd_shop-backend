import { HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';

import { REQUEST_ID_HEADER } from '@/common/constants';

/**
 * Extracts the error message or response object from the exception.
 * @param exception - The exception that was thrown
 * @returns The error message string or response object
 */
export function extractMessage(exception: unknown): object | string {
  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    return typeof response === 'object' && 'message' in response
      ? (response as { message: string | string[] }).message
      : response;
  }
  return 'Internal server error';
}

/**
 * Extracts the request ID from the request headers.
 * @param request - The Express request object
 * @returns The request ID or undefined if not present
 */
export function extractRequestId(request: Request): string | undefined {
  return request.headers[REQUEST_ID_HEADER] as string | undefined;
}

/**
 * Extracts the HTTP status code from the exception.
 * @param exception - The exception that was thrown
 * @returns The HTTP status code
 */
export function extractStatus(exception: unknown): number {
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
export function formatMessage(message: object | string): string | string[] {
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
