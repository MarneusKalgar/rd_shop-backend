import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { EntityNotFoundError, QueryFailedError } from 'typeorm';

import { REQUEST_ID_HEADER } from '@/common/constants';

import { GraphQLContext } from '../http-exception';

/**
 * Standardized error response format for GraphQL errors.
 *
 * @interface ErrorResponse
 * @property {string} code - Machine-readable error code (e.g., 'BAD_USER_INPUT', 'NOT_FOUND')
 * @property {Record<string, any>} [extensions] - Optional additional error context and metadata
 * @property {string} message - Human-readable error message
 * @property {number} statusCode - HTTP status code associated with the error
 */
export interface ErrorResponse {
  code: string;
  extensions?: Record<string, any>;
  message: string;
  statusCode: number;
}

/**
 * Response format for NestJS validation errors.
 *
 * @interface ValidationErrorResponse
 * @property {string} [error] - Optional error type description
 * @property {string | string[]} message - Validation error message(s)
 * @property {number} [statusCode] - Optional HTTP status code
 */
interface ValidationErrorResponse {
  error?: string;
  message: string | string[];
  statusCode?: number;
}

/**
 * Extracts the request ID from GraphQL context headers.
 *
 * @param {GraphQLContext} context - GraphQL execution context containing request headers
 * @returns {string} The request ID from headers, or 'unknown' if not found
 *
 * @example
 * const requestId = extractRequestIdFromGraphQL(context);
 * // Returns: 'req-abc-123' or 'unknown'
 */
export function extractRequestIdFromGraphQL(context: GraphQLContext): string {
  const requestId = context?.req?.headers?.[REQUEST_ID_HEADER];
  return Array.isArray(requestId) ? requestId[0] : (requestId ?? 'unknown');
}

/**
 * Maps HTTP status codes to GraphQL error codes.
 *
 * Converts standard HTTP status codes to GraphQL-specific error codes
 * following Apollo Server conventions.
 *
 * @param {number} httpStatus - HTTP status code (e.g., 400, 404, 500)
 * @returns {string} GraphQL error code (e.g., 'BAD_USER_INPUT', 'NOT_FOUND', 'INTERNAL_SERVER_ERROR')
 *
 * @example
 * getErrorCode(404); // Returns: 'NOT_FOUND'
 * getErrorCode(401); // Returns: 'UNAUTHENTICATED'
 * getErrorCode(500); // Returns: 'INTERNAL_SERVER_ERROR'
 */
export function getErrorCode(httpStatus: number): string {
  const codeMap: Record<number, string> = {
    [HttpStatus.BAD_REQUEST]: 'BAD_USER_INPUT',
    [HttpStatus.CONFLICT]: 'CONFLICT',
    [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
    [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
    [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
    [HttpStatus.UNPROCESSABLE_ENTITY]: 'BAD_USER_INPUT',
  };

  return codeMap[httpStatus] || (httpStatus >= 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST');
}

/**
 * Normalizes various exception types into a standardized GraphQL error response.
 *
 * Handles different error types from NestJS, TypeORM, and unexpected errors,
 * converting them into a consistent ErrorResponse format with appropriate
 * error codes and messages.
 *
 * @param {unknown} exception - The exception to normalize (can be any error type)
 * @returns {ErrorResponse} Normalized error response with code, message, statusCode, and optional extensions
 *
 * @remarks
 * Handles the following error types:
 * - BadRequestException: Validation errors with detailed validation messages
 * - QueryFailedError: Database operation errors
 * - EntityNotFoundError: TypeORM entity not found errors
 * - HttpException: General NestJS HTTP exceptions
 * - Unknown errors: Unexpected errors with safe fallback messages
 *
 * In non-production environments, unexpected errors include the original error message
 * in extensions for debugging purposes.
 *
 * @example
 * // Validation error
 * const error = normalizeGQLError(new BadRequestException('Invalid input'));
 * // Returns: { code: 'BAD_USER_INPUT', message: 'Validation failed', statusCode: 400, extensions: {...} }
 *
 * @example
 * // Not found error
 * const error = normalizeGQLError(new NotFoundException('User not found'));
 * // Returns: { code: 'NOT_FOUND', message: 'User not found', statusCode: 404 }
 */
export function normalizeGQLError(exception: unknown): ErrorResponse {
  // Validation errors
  if (exception instanceof BadRequestException) {
    const response = exception.getResponse() as ValidationErrorResponse;
    const validationErrors = response.message || response;

    return {
      code: 'BAD_USER_INPUT',
      extensions: { validationErrors },
      message: 'Validation failed',
      statusCode: HttpStatus.BAD_REQUEST,
    };
  }

  // Database errors
  if (exception instanceof QueryFailedError) {
    return {
      code: 'DATABASE_ERROR',
      message: 'Database operation failed',
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    };
  }

  // Entity not found
  if (exception instanceof EntityNotFoundError) {
    return {
      code: 'NOT_FOUND',
      message: 'Resource not found',
      statusCode: HttpStatus.NOT_FOUND,
    };
  }

  // HTTP exceptions
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const typedResponse =
      typeof response === 'string' ? response : (response as ValidationErrorResponse).message;
    const errorMessage = Array.isArray(typedResponse)
      ? typedResponse.join(', ')
      : typedResponse || exception.message;

    return {
      code: getErrorCode(status),
      message: errorMessage,
      statusCode: status,
    };
  }

  // Unexpected errors
  return {
    code: 'INTERNAL_SERVER_ERROR',
    extensions:
      process.env.NODE_ENV !== 'production'
        ? {
            originalError: exception instanceof Error ? exception.message : String(exception),
          }
        : undefined,
    message: 'An unexpected error occurred',
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
  };
}
