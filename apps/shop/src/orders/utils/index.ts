import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { encodeCursor } from '@/common/utils';

import { MAX_ORDER_QUANTITY } from '../constants';
import { CreateOrderDto } from '../dto';
import { Order } from '../order.entity';

/**
 * Asserts that the given order exists and belongs to `userId`.
 * Throws `NotFoundException` for both the "not found" and "wrong owner" cases
 * to prevent IDOR disclosure of other users' order IDs.
 *
 * This is a TypeScript assertion function — after it returns without throwing,
 * the compiler narrows `order` to `Order` (non-nullable).
 *
 * @throws {NotFoundException} If `order` is null or `order.userId !== userId`
 */
export function assertOrderOwnership(order: null | Order, userId: string): asserts order is Order {
  if (order?.userId !== userId) {
    throw new NotFoundException(`Order with ID "${order?.id ?? 'unknown'}" not found`);
  }
}

/**
 * Computes the order total in the smallest currency unit (cents).
 * Rounds each line item individually before summing to avoid floating-point drift.
 *
 * Formula per item: `Math.round(parseFloat(priceAtPurchase) × quantity × 100)`
 */
export const getTotalSumInCents = (order: Order) => {
  return order.items.reduce((sum, item) => {
    return sum + Math.round(parseFloat(item.priceAtPurchase) * item.quantity * 100);
  }, 0);
};

/**
 * Runs the two mandatory per-transaction timeouts inside the provided manager.
 * Must be called at the start of every order transaction body.
 *
 * - `statement_timeout = 30s` — aborts any single query that runs too long (PG code 57014)
 * - `lock_timeout = 10s` — aborts pessimistic-lock waits that stall too long (PG code 55P03)
 */
export async function applyTransactionTimeouts(manager: EntityManager): Promise<void> {
  await manager.query('SET LOCAL statement_timeout = 30000');
  await manager.query('SET LOCAL lock_timeout = 10000');
}

/**
 * Validates each order item's quantity against domain rules.
 * Runs outside any transaction — cheap fast-fail before acquiring DB locks.
 *
 * @throws {BadRequestException} If any item has `quantity <= 0` or `quantity > MAX_ORDER_QUANTITY`
 */
export function validateOrderItems(items: CreateOrderDto['items']): void {
  for (const item of items) {
    if (item.quantity <= 0) {
      throw new BadRequestException(
        `Quantity must be greater than zero for product ${item.productId}`,
      );
    }

    if (item.quantity > MAX_ORDER_QUANTITY) {
      throw new BadRequestException(
        `Quantity cannot exceed ${MAX_ORDER_QUANTITY} for product ${item.productId}`,
      );
    }
  }
}

/**
 * Builds the opaque cursor string for the next page of orders.
 * Returns `null` when there is no next page.
 *
 * Cursor format: `${lastId}|${lastCreatedAt epoch ms}` (via `encodeCursor`).
 * The last element of `pageSlice` is used as the cursor anchor.
 */
export const buildOrderNextCursor = (
  pageSlice: { createdAt: Date | string; id: string }[],
  hasNextPage: boolean,
): null | string => {
  if (!hasNextPage) return null;
  const last = pageSlice[pageSlice.length - 1];
  return encodeCursor(last.id, String(new Date(last.createdAt).getTime()));
};
