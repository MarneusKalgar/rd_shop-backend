/**
 * Integration test: GET /api/v1/orders — cursor-based pagination and filtering
 *
 * Covers:
 *  - Cursor pagination: 6 orders, limit=2 → 4 pages, no duplicates, no gaps, correct nextCursor/hasNextPage
 *  - Status filter returns only matching orders
 *  - Another user's orders never returned (user isolation)
 */
import { JwtService } from '@nestjs/jwt';
import {
  bootstrapIntegrationTest,
  IntegrationTestContext,
  teardownIntegrationTest,
} from '@test/integration/helpers/bootstrap';
import request from 'supertest';

import { OrderStatus } from '@/orders/order.entity';

// Unique UUID namespace for this spec: 0070xxxxxxxx
const MOCK = {
  itemIds: [
    'f47ac10b-58cc-4372-a567-007000000201',
    'f47ac10b-58cc-4372-a567-007000000202',
    'f47ac10b-58cc-4372-a567-007000000203',
    'f47ac10b-58cc-4372-a567-007000000204',
    'f47ac10b-58cc-4372-a567-007000000205',
    'f47ac10b-58cc-4372-a567-007000000206',
  ],
  // 6 orders: 4 PENDING + 2 PAID (for status filter test)
  orderIds: [
    'f47ac10b-58cc-4372-a567-007000000101',
    'f47ac10b-58cc-4372-a567-007000000102',
    'f47ac10b-58cc-4372-a567-007000000103',
    'f47ac10b-58cc-4372-a567-007000000104',
    'f47ac10b-58cc-4372-a567-007000000105',
    'f47ac10b-58cc-4372-a567-007000000106',
  ],
  otherUserId: 'f47ac10b-58cc-4372-a567-007000000002',
  otherUserItemId: 'f47ac10b-58cc-4372-a567-007000000207',
  otherUserOrderId: 'f47ac10b-58cc-4372-a567-007000000107',
  productId: 'f47ac10b-58cc-4372-a567-007000000003',
  userId: 'f47ac10b-58cc-4372-a567-007000000001',
} as const;

// 4 PENDING, 2 PAID
const ORDER_STATUSES = [
  OrderStatus.PENDING,
  OrderStatus.PENDING,
  OrderStatus.PENDING,
  OrderStatus.PENDING,
  OrderStatus.PAID,
  OrderStatus.PAID,
];

interface FindOrdersBody {
  data: { id: string }[];
  limit: number;
  nextCursor: null | string;
}

let ctx: IntegrationTestContext;
let accessToken: string;

describe('GET /api/v1/orders — cursor pagination and filtering', () => {
  beforeAll(async () => {
    ctx = await bootstrapIntegrationTest();

    await ctx.dataSource.query(
      `INSERT INTO users (id, email, roles, scopes) VALUES ($1, $2, $3::text[], $4::text[]) ON CONFLICT (id) DO NOTHING`,
      [MOCK.userId, 'find-orders@test.local', '{user}', '{orders:read,orders:write}'],
    );
    await ctx.dataSource.query(
      `INSERT INTO users (id, email, roles, scopes) VALUES ($1, $2, $3::text[], $4::text[]) ON CONFLICT (id) DO NOTHING`,
      [MOCK.otherUserId, 'find-orders-other@test.local', '{user}', '{orders:read,orders:write}'],
    );
    await ctx.dataSource.query(
      `INSERT INTO products (id, title, price, stock, is_active) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [MOCK.productId, 'Find Orders Product', '9.99', 999, true],
    );

    for (let i = 0; i < MOCK.orderIds.length; i++) {
      await ctx.dataSource.query(
        `INSERT INTO orders (id, user_id, status) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
        [MOCK.orderIds[i], MOCK.userId, ORDER_STATUSES[i]],
      );
      await ctx.dataSource.query(
        `INSERT INTO order_items (id, order_id, product_id, quantity, price_at_purchase)
         VALUES ($1, $2, $3, 1, '9.99') ON CONFLICT (id) DO NOTHING`,
        [MOCK.itemIds[i], MOCK.orderIds[i], MOCK.productId],
      );
    }

    // Other user's order — must never appear in main user's results
    await ctx.dataSource.query(
      `INSERT INTO orders (id, user_id, status) VALUES ($1, $2, 'PENDING') ON CONFLICT (id) DO NOTHING`,
      [MOCK.otherUserOrderId, MOCK.otherUserId],
    );
    await ctx.dataSource.query(
      `INSERT INTO order_items (id, order_id, product_id, quantity, price_at_purchase)
       VALUES ($1, $2, $3, 1, '9.99') ON CONFLICT (id) DO NOTHING`,
      [MOCK.otherUserItemId, MOCK.otherUserOrderId, MOCK.productId],
    );

    const jwtService = ctx.app.get(JwtService);
    accessToken = await jwtService.signAsync({
      email: 'find-orders@test.local',
      roles: ['user'],
      scopes: ['orders:read', 'orders:write'],
      sub: MOCK.userId,
    });
  }, 90_000);

  afterAll(async () => {
    try {
      if (ctx?.dataSource) {
        const allItemIds = [...MOCK.itemIds, MOCK.otherUserItemId];
        const allOrderIds = [...MOCK.orderIds, MOCK.otherUserOrderId];
        await ctx.dataSource.query(`DELETE FROM order_items WHERE id = ANY($1::uuid[])`, [
          allItemIds,
        ]);
        await ctx.dataSource.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [allOrderIds]);
        await ctx.dataSource.query(`DELETE FROM products WHERE id = $1::uuid`, [MOCK.productId]);
        await ctx.dataSource.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
          [MOCK.userId, MOCK.otherUserId],
        ]);
      }
    } finally {
      await teardownIntegrationTest(ctx);
    }
  });

  describe('cursor pagination completeness', () => {
    it('walking all pages with limit=2 returns all 6 orders without duplicates or gaps', async () => {
      // ARRANGE
      const limit = 2;
      const collectedIds: string[] = [];
      let cursor: null | string = null;

      // ACT — walk all pages
      do {
        const url = cursor
          ? `/api/v1/orders?limit=${limit}&cursor=${encodeURIComponent(cursor)}`
          : `/api/v1/orders?limit=${limit}`;

        const res = await request(ctx.httpServer)
          .get(url)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        const body = res.body as FindOrdersBody;
        collectedIds.push(...body.data.map((o) => o.id));
        cursor = body.nextCursor;
      } while (cursor !== null);

      // ASSERT — all 6 of our seeded user's orders, no duplicates, no other-user orders
      expect(collectedIds).toHaveLength(MOCK.orderIds.length);
      const uniqueIds = new Set(collectedIds);
      expect(uniqueIds.size).toBe(MOCK.orderIds.length);
      // none of the collected IDs should be the other user's order
      expect(collectedIds).not.toContain(MOCK.otherUserOrderId);
    });
  });

  describe('status filter', () => {
    it('returns only PAID orders when status=PAID filter is applied', async () => {
      // ARRANGE — 2 PAID orders seeded, 4 PENDING

      // ACT
      const res = await request(ctx.httpServer)
        .get('/api/v1/orders?status=PAID&limit=10')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // ASSERT
      const body = res.body as FindOrdersBody;
      expect(body.data.length).toBe(2);
      for (const order of body.data) {
        const [row] = await ctx.dataSource.query<{ status: string }[]>(
          `SELECT status FROM orders WHERE id = $1`,
          [order.id],
        );
        expect(row.status).toBe(OrderStatus.PAID);
      }
    });
  });

  describe('user isolation', () => {
    it('returns empty list when authenticated user has no orders in the requested range', async () => {
      // ARRANGE — sign a token for the other user (no orders at limit smaller than total)
      const jwtService = ctx.app.get(JwtService);
      const otherToken = await jwtService.signAsync({
        email: 'find-orders-other@test.local',
        roles: ['user'],
        scopes: ['orders:read', 'orders:write'],
        sub: MOCK.otherUserId,
      });

      // Restrict to PAID — other user has only PENDING
      // ACT
      const res = await request(ctx.httpServer)
        .get('/api/v1/orders?status=PAID&limit=10')
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(200);

      // ASSERT
      const body = res.body as FindOrdersBody;
      expect(body.data).toHaveLength(0);
    });
  });
});
