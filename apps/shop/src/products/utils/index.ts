import { ConflictException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

const UNIQUE_VIOLATION_CODE = '23505';

export function omitUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function throwOnUniqueViolation(error: unknown, message: string): never {
  if (
    error instanceof QueryFailedError &&
    (error as { code?: string }).code === UNIQUE_VIOLATION_CODE
  ) {
    throw new ConflictException(message);
  }
  throw error as Error;
}
