import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { MAX_ORDER_QUANTITY } from '../constants';
import { Order, OrderItem } from '../order.entity';
import {
  applyTransactionTimeouts,
  assertOrderOwnership,
  buildOrderNextCursor,
  getTotalSumInCents,
  validateOrderItems,
} from './index';

// ─── helpers ─────────────────────────────────────────────────────────────────

const makeOrder = (overrides: Partial<Order> = {}): Order =>
  ({ id: 'order-1', items: [], userId: 'user-1', ...overrides }) as unknown as Order;

const makeItem = (priceAtPurchase: string, quantity: number): OrderItem =>
  ({ priceAtPurchase, quantity }) as unknown as OrderItem;

// ─── assertOrderOwnership ────────────────────────────────────────────────────

describe('assertOrderOwnership', () => {
  it('does not throw when order belongs to the given user', () => {
    expect(() => assertOrderOwnership(makeOrder(), 'user-1')).not.toThrow();
  });

  it('throws NotFoundException when order is null', () => {
    expect(() => assertOrderOwnership(null, 'user-1')).toThrow(NotFoundException);
  });

  it('throws NotFoundException when userId does not match', () => {
    expect(() => assertOrderOwnership(makeOrder({ userId: 'other' }), 'user-1')).toThrow(
      NotFoundException,
    );
  });

  it('includes "unknown" in message when order is null', () => {
    expect(() => assertOrderOwnership(null, 'user-1')).toThrow(/unknown/);
  });

  it('includes the order id in message when userId mismatches', () => {
    expect(() => assertOrderOwnership(makeOrder({ id: 'ord-99', userId: 'x' }), 'user-1')).toThrow(
      /ord-99/,
    );
  });
});

// ─── getTotalSumInCents ──────────────────────────────────────────────────────

describe('getTotalSumInCents', () => {
  it('returns 0 for an order with no items', () => {
    expect(getTotalSumInCents(makeOrder({ items: [] }))).toBe(0);
  });

  it('calculates total for a single item', () => {
    // 9.99 * 2 * 100 = 1998
    const order = makeOrder({ items: [makeItem('9.99', 2)] });
    expect(getTotalSumInCents(order)).toBe(1998);
  });

  it('sums multiple items', () => {
    // (10.00 * 1 * 100) + (5.50 * 2 * 100) = 1000 + 1100 = 2100
    const order = makeOrder({ items: [makeItem('10.00', 1), makeItem('5.50', 2)] });
    expect(getTotalSumInCents(order)).toBe(2100);
  });

  it('rounds fractional cents per item before summing', () => {
    // 0.001 * 1 * 100 = 0.1 → Math.round → 0
    const order = makeOrder({ items: [makeItem('0.001', 1)] });
    expect(getTotalSumInCents(order)).toBe(0);
  });

  it('handles integer price strings', () => {
    const order = makeOrder({ items: [makeItem('100', 3)] });
    expect(getTotalSumInCents(order)).toBe(30000);
  });
});

// ─── validateOrderItems ──────────────────────────────────────────────────────

describe('validateOrderItems', () => {
  it('does not throw for valid items', () => {
    expect(() =>
      validateOrderItems([
        { productId: 'p1', quantity: 1 },
        { productId: 'p2', quantity: MAX_ORDER_QUANTITY },
      ]),
    ).not.toThrow();
  });

  it('throws BadRequestException when quantity is 0', () => {
    expect(() => validateOrderItems([{ productId: 'p1', quantity: 0 }])).toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException when quantity is negative', () => {
    expect(() => validateOrderItems([{ productId: 'p1', quantity: -1 }])).toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException when quantity exceeds MAX_ORDER_QUANTITY', () => {
    expect(() =>
      validateOrderItems([{ productId: 'p1', quantity: MAX_ORDER_QUANTITY + 1 }]),
    ).toThrow(BadRequestException);
  });

  it('includes the product id in the error message for quantity <= 0', () => {
    expect(() => validateOrderItems([{ productId: 'bad-prod', quantity: 0 }])).toThrow(/bad-prod/);
  });

  it('includes the product id in the error message for quantity > MAX', () => {
    expect(() =>
      validateOrderItems([{ productId: 'bad-prod', quantity: MAX_ORDER_QUANTITY + 1 }]),
    ).toThrow(/bad-prod/);
  });

  it('throws on the first invalid item and does not continue', () => {
    const items = [
      { productId: 'ok', quantity: 1 },
      { productId: 'bad', quantity: 0 },
      { productId: 'also-bad', quantity: -5 },
    ];
    expect(() => validateOrderItems(items)).toThrow(/bad/);
  });
});

// ─── buildOrderNextCursor ────────────────────────────────────────────────────

describe('buildOrderNextCursor', () => {
  const slice = [
    { createdAt: new Date('2024-01-01T00:00:00.000Z'), id: 'a' },
    { createdAt: new Date('2024-06-15T12:30:00.000Z'), id: 'b' },
  ];

  it('returns null when hasNextPage is false', () => {
    expect(buildOrderNextCursor(slice, false)).toBeNull();
  });

  it('returns a cursor string when hasNextPage is true', () => {
    expect(buildOrderNextCursor(slice, true)).not.toBeNull();
  });

  it('encodes the last item id into the cursor', () => {
    const cursor = buildOrderNextCursor(slice, true)!;
    expect(cursor).toContain('b');
  });

  it('encodes the last item createdAt epoch ms into the cursor', () => {
    const cursor = buildOrderNextCursor(slice, true)!;
    const expectedMs = String(new Date('2024-06-15T12:30:00.000Z').getTime());
    expect(cursor).toContain(expectedMs);
  });

  it('accepts createdAt as a string', () => {
    const strSlice = [{ createdAt: '2024-01-01T00:00:00.000Z', id: 'c' }];
    const cursor = buildOrderNextCursor(strSlice, true)!;
    const expectedMs = String(new Date('2024-01-01T00:00:00.000Z').getTime());
    expect(cursor).toContain(expectedMs);
  });

  it('uses only the last element of the slice for the cursor', () => {
    const cursor = buildOrderNextCursor(slice, true)!;
    expect(cursor).not.toContain('a');
  });
});

// ─── applyTransactionTimeouts ─────────────────────────────────────────────────

describe('applyTransactionTimeouts', () => {
  it('calls manager.query with statement_timeout and lock_timeout', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const manager = { query } as unknown as EntityManager;

    await applyTransactionTimeouts(manager);

    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledWith('SET LOCAL statement_timeout = 30000');
    expect(query).toHaveBeenCalledWith('SET LOCAL lock_timeout = 10000');
  });

  it('sets statement_timeout before lock_timeout', async () => {
    const calls: string[] = [];
    const query = jest.fn().mockImplementation((sql: string) => {
      calls.push(sql);
      return Promise.resolve();
    });
    const manager = { query } as unknown as EntityManager;

    await applyTransactionTimeouts(manager);

    expect(calls[0]).toContain('statement_timeout');
    expect(calls[1]).toContain('lock_timeout');
  });
});
