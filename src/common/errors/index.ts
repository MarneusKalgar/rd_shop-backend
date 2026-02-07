export abstract class BaseError extends Error {
  abstract readonly code: string;
  readonly details?: Record<string, unknown>;
  abstract readonly httpStatus: number;

  protected constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.details = details;
  }
}

export class UserEmailExistsError extends BaseError {
  readonly code = 'USER_EMAIL_EXISTS';
  readonly httpStatus = 409;

  constructor(email: string) {
    super('User with this email already exists', { email });
  }
}

export class UserNotFoundError extends BaseError {
  readonly code = 'USER_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(userId: string) {
    super('User not found', { userId });
  }
}

export class ValidationError extends BaseError {
  readonly code = 'VALIDATION_FAILED';
  readonly httpStatus = 400;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}
