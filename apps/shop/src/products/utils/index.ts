import { ConflictException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

import { encodeCursor } from '@/common/utils';

import { ProductSortBy } from '../constants';
import { Product } from '../product.entity';

const UNIQUE_VIOLATION_CODE = '23505';

export function buildProductNextCursor(
  page: Product[],
  sortBy: ProductSortBy,
  hasNextPage: boolean,
): null | string {
  if (!hasNextPage) return null;

  const last = page[page.length - 1];

  let sortValue: string;

  switch (sortBy) {
    case ProductSortBy.PRICE:
      sortValue = last.price;
      break;
    case ProductSortBy.TITLE:
      sortValue = last.title;
      break;
    default:
      sortValue = String(last.createdAt.getTime());
  }

  return encodeCursor(last.id, sortValue);
}

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
