import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { EntityNotFoundError, QueryFailedError } from 'typeorm';

import { REQUEST_ID_HEADER } from '@/common/constants';

import { GraphQLContext } from '../http-exception';

export interface ErrorResponse {
  code: string;
  extensions?: Record<string, any>;
  message: string;
  statusCode: number;
}

interface ValidationErrorResponse {
  error?: string;
  message: string | string[];
  statusCode?: number;
}

export function extractRequestIdFromGraphQL(context: GraphQLContext): string {
  const requestId = context?.req?.headers?.[REQUEST_ID_HEADER];
  return Array.isArray(requestId) ? requestId[0] : (requestId ?? 'unknown');
}

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
