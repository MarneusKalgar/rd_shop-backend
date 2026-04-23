/**
 * Integration test: POST /api/v1/orders/:orderId/cancellation — order cancellation
 *
 * Covers:
 *  - Cancel PENDING order: 200, status=CANCELLED, stock restored
 *  - Cancel PROCESSED order: 200, status=CANCELLED, stock restored
 *  - Cancel PAID order: 200, status=CANCELLED, stock restored
 *  - Cancel already CANCELLED order: 409
 *  - Cancel another user's order: 404 (ownership assertion, not 403)
 */
import { JwtService } from '@nestjs/jwt';
import {
  bootstrapIntegrationTest,
  IntegrationTestContext,
  teardownIntegrationTest,
} from '@test/integration/helpers/bootstrap';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { OrderStatus } from '@/orders/order.entity';

// Unique UUID namespace for this spec: 0030xxxxxxxx
const MOCK = {
  cancelledItemId: 'f47ac10b-58cc-4372-a567-003000000204',
  cancelledOrderId: 'f47ac10b-58cc-4372-a567-003000000104',
  otherUserId: 'f47ac10b-58cc-4372-a567-003000000002',
  otherUserItemId: 'f47ac10b-58cc-4372-a567-003000000205',
  otherUserOrderId: 'f47ac10b-58cc-4372-a567-003000000105',
  paidItemId: 'f47ac10b-58cc-4372-a567-003000000203',
  paidOrderId: 'f47ac10b-58cc-4372-a567-003000000103',
  // item IDs
  pendingItemId: 'f47ac10b-58cc-4372-a567-003000000201',
  // order IDs: one per cancel scenario
  pendingOrderId: 'f47ac10b-58cc-4372-a567-003000000101',
  processedItemId: 'f47ac10b-58cc-4372-a567-003000000202',
  processedOrderId: 'f47ac10b-58cc-4372-a567-003000000102',
  productId: 'f47ac10b-58cc-4372-a567-003000000003',
  userId: 'f47ac10b-58cc-4372-a567-003000000001',
} as const;

const ITEM_QUANTITY = 2;
const INITIAL_STOCK = 20;

let ctx: IntegrationTestContext;
let accessToken: string;

async function seedOrder(
  ds: DataSource,
  orderId: string,
  itemId: string,
  userId: string,
  status: OrderStatus,
): Promise<void> {
  await ds.query(
    `INSERT INTO orders (id, user_id, status) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
    [orderId, userId, status],
  );
  await ds.query(
    `INSERT INTO order_items (id, order_id, product_id, quantity, price_at_purchase)
     VALUES ($1, $2, $3, $4, '9.99') ON CONFLICT (id) DO NOTHING`,
    [itemId, orderId, MOCK.productId, ITEM_QUANTITY],
  );
}

describe('POST /api/v1/orders/:orderId/cancellation — order cancellation', () => {
  beforeAll(async () => {
    ctx = await bootstrapIntegrationTest();

    // Seed users
    await ctx.dataSource.query(
      `INSERT INTO users (id, email, roles, scopes) VALUES ($1, $2, $3::text[], $4::text[]) ON CONFLICT (id) DO NOTHING`,
      [MOCK.userId, 'cancel-order@test.local', '{user}', '{orders:read,orders:write}'],
    );
    await ctx.dataSource.query(
      `INSERT INTO users (id, email, roles, scopes) VALUES ($1, $2, $3::text[], $4::text[]) ON CONFLICT (id) DO NOTHING`,
      [MOCK.otherUserId, 'cancel-order-other@test.local', '{user}', '{orders:read,orders:write}'],
    );

    // Seed product with stock
    await ctx.dataSource.query(
      `INSERT INTO products (id, title, price, stock, is_active) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [MOCK.productId, 'Cancel Test Product', '9.99', INITIAL_STOCK, true],
    );

    // Seed orders for each cancel scenario
    await seedOrder(
      ctx.dataSource,
      MOCK.pendingOrderId,
      MOCK.pendingItemId,
      MOCK.userId,
      OrderStatus.PENDING,
    );
    await seedOrder(
      ctx.dataSource,
      MOCK.processedOrderId,
      MOCK.processedItemId,
      MOCK.userId,
      OrderStatus.PROCESSED,
    );
    await seedOrder(
      ctx.dataSource,
      MOCK.paidOrderId,
      MOCK.paidItemId,
      MOCK.userId,
      OrderStatus.PAID,
    );
    await seedOrder(
      ctx.dataSource,
      MOCK.cancelledOrderId,
      MOCK.cancelledItemId,
      MOCK.userId,
      OrderStatus.CANCELLED,
    );
    await seedOrder(
      ctx.dataSource,
      MOCK.otherUserOrderId,
      MOCK.otherUserItemId,
      MOCK.otherUserId,
      OrderStatus.PENDING,
    );

    const jwtService = ctx.app.get(JwtService);
    accessToken = await jwtService.signAsync({
      email: 'cancel-order@test.local',
      roles: ['user'],
      scopes: ['orders:read', 'orders:write'],
      sub: MOCK.userId,
    });
  }, 90_000);

  afterAll(async () => {
    try {
      if (ctx?.dataSource) {
        const allOrderIds = [
          MOCK.pendingOrderId,
          MOCK.processedOrderId,
          MOCK.paidOrderId,
          MOCK.cancelledOrderId,
          MOCK.otherUserOrderId,
        ];
        const allItemIds = [
          MOCK.pendingItemId,
          MOCK.processedItemId,
          MOCK.paidItemId,
          MOCK.cancelledItemId,
          MOCK.otherUserItemId,
        ];
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

  describe('cancel PENDING order', () => {
    it('returns 200 with CANCELLED status and restores stock', async () => {
      // ARRANGE
      const [before] = await ctx.dataSource.query<{ stock: number }[]>(
        `SELECT stock FROM products WHERE id = $1`,
        [MOCK.productId],
      );
      const stockBefore = before.stock;

      // ACT
      const response = await request(ctx.httpServer)
        .post(`/api/v1/orders/${MOCK.pendingOrderId}/cancellation`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // ASSERT
      expect((response.body as { data: { status: string } }).data.status).toBe(
        OrderStatus.CANCELLED,
      );

      const [after] = await ctx.dataSource.query<{ stock: number }[]>(
        `SELECT stock FROM products WHERE id = $1`,
        [MOCK.productId],
      );
      expect(after.stock).toBe(stockBefore + ITEM_QUANTITY);
    });
  });

  describe('cancel PROCESSED order', () => {
    it('returns 200 with CANCELLED status and restores stock', async () => {
      // ARRANGE
      const [before] = await ctx.dataSource.query<{ stock: number }[]>(
        `SELECT stock FROM products WHERE id = $1`,
        [MOCK.productId],
      );
      const stockBefore = before.stock;

      // ACT
      const response = await request(ctx.httpServer)
        .post(`/api/v1/orders/${MOCK.processedOrderId}/cancellation`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // ASSERT
      expect((response.body as { data: { status: string } }).data.status).toBe(
        OrderStatus.CANCELLED,
      );
      const [after] = await ctx.dataSource.query<{ stock: number }[]>(
        `SELECT stock FROM products WHERE id = $1`,
        [MOCK.productId],
      );
      expect(after.stock).toBe(stockBefore + ITEM_QUANTITY);
    });
  });

  describe('cancel PAID order', () => {
    it('returns 200 with CANCELLED status and restores stock', async () => {
      // ARRANGE
      const [before] = await ctx.dataSource.query<{ stock: number }[]>(
        `SELECT stock FROM products WHERE id = $1`,
        [MOCK.productId],
      );
      const stockBefore = before.stock;

      // ACT
      const response = await request(ctx.httpServer)
        .post(`/api/v1/orders/${MOCK.paidOrderId}/cancellation`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // ASSERT
      expect((response.body as { data: { status: string } }).data.status).toBe(
        OrderStatus.CANCELLED,
      );
      const [after] = await ctx.dataSource.query<{ stock: number }[]>(
        `SELECT stock FROM products WHERE id = $1`,
        [MOCK.productId],
      );
      expect(after.stock).toBe(stockBefore + ITEM_QUANTITY);
    });
  });

  describe('cancel already CANCELLED order', () => {
    it('returns 409 Conflict', async () => {
      // ARRANGE — order is already in CANCELLED status

      // ACT & ASSERT
      await request(ctx.httpServer)
        .post(`/api/v1/orders/${MOCK.cancelledOrderId}/cancellation`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(409);
    });
  });

  describe("cancel another user's order", () => {
    it('returns 404 (ownership assertion, not 403)', async () => {
      // ARRANGE — order belongs to otherUserId, not the authenticated userId

      // ACT & ASSERT
      await request(ctx.httpServer)
        .post(`/api/v1/orders/${MOCK.otherUserOrderId}/cancellation`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });
  });
});
