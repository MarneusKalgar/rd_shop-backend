import {
  bootstrapIntegrationTest,
  IntegrationTestContext,
  teardownIntegrationTest,
  triggerConsumer,
} from '@test/integration/helpers/bootstrap';
/**
 * Integration test: OrderWorkerService consumer — idempotency guard
 *
 * Triggered via the RabbitMQ consumer handler (same entry point as production).
 * Verifies that the ProcessedMessage deduplication layer prevents double-processing:
 *  - Same messageId processed twice sequentially → second call is a no-op,
 *    processed_messages table has exactly 1 row for that messageId
 *  - Concurrent duplicate insert (23505 unique violation path) is handled safely
 */
import { DataSource } from 'typeorm';

import { OrderProcessMessageDto } from '@/orders/dto';
import { OrderStatus } from '@/orders/order.entity';

// Unique UUID namespace for this spec: 0050xxxxxxxx
const MOCK = {
  concItemId: 'f47ac10b-58cc-4372-a567-005000000202',
  concMessageId: 'f47ac10b-58cc-4372-a567-005000000302',
  concOrderId: 'f47ac10b-58cc-4372-a567-005000000102',
  productId: 'f47ac10b-58cc-4372-a567-005000000002',
  // items
  seqItemId: 'f47ac10b-58cc-4372-a567-005000000201',
  // deterministic messageIds so we can assert on processed_messages
  seqMessageId: 'f47ac10b-58cc-4372-a567-005000000301',
  // orders used across tests
  seqOrderId: 'f47ac10b-58cc-4372-a567-005000000101',
  userId: 'f47ac10b-58cc-4372-a567-005000000001',
} as const;

let ctx: IntegrationTestContext;

async function seedPendingOrder(ds: DataSource, orderId: string, itemId: string): Promise<void> {
  await ds.query(
    `INSERT INTO orders (id, user_id, status) VALUES ($1, $2, 'PENDING') ON CONFLICT (id) DO NOTHING`,
    [orderId, MOCK.userId],
  );
  await ds.query(
    `INSERT INTO order_items (id, order_id, product_id, quantity, price_at_purchase)
     VALUES ($1, $2, $3, 1, '9.99') ON CONFLICT (id) DO NOTHING`,
    [itemId, orderId, MOCK.productId],
  );
}

describe('OrderWorkerService consumer — idempotency guard', () => {
  beforeAll(async () => {
    ctx = await bootstrapIntegrationTest();
    process.env.RABBITMQ_DISABLE_PAYMENTS_AUTHORIZATION = 'true';
    ctx.paymentsGrpcMock.authorize.mockResolvedValue({
      paymentId: 'pay_idem_001',
      status: 'COMPLETED',
    });

    await ctx.dataSource.query(
      `INSERT INTO users (id, email, roles, scopes) VALUES ($1, $2, $3::text[], $4::text[]) ON CONFLICT (id) DO NOTHING`,
      [MOCK.userId, 'idem@test.local', '{user}', '{orders:read,orders:write}'],
    );
    await ctx.dataSource.query(
      `INSERT INTO products (id, title, price, stock, is_active) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [MOCK.productId, 'Idem Test Product', '9.99', 50, true],
    );

    await seedPendingOrder(ctx.dataSource, MOCK.seqOrderId, MOCK.seqItemId);
    await seedPendingOrder(ctx.dataSource, MOCK.concOrderId, MOCK.concItemId);
  }, 90_000);

  afterAll(async () => {
    try {
      if (ctx?.dataSource) {
        await ctx.dataSource.query(
          `DELETE FROM processed_messages WHERE message_id = ANY($1::text[])`,
          [[MOCK.seqMessageId, MOCK.concMessageId]],
        );
        await ctx.dataSource.query(`DELETE FROM order_items WHERE id = ANY($1::uuid[])`, [
          [MOCK.seqItemId, MOCK.concItemId],
        ]);
        await ctx.dataSource.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [
          [MOCK.seqOrderId, MOCK.concOrderId],
        ]);
        await ctx.dataSource.query(`DELETE FROM products WHERE id = $1::uuid`, [MOCK.productId]);
        await ctx.dataSource.query(`DELETE FROM users WHERE id = $1::uuid`, [MOCK.userId]);
      }
    } finally {
      await teardownIntegrationTest(ctx);
    }
  });

  describe('sequential duplicate', () => {
    it('second call with same messageId is a no-op; processed_messages has exactly 1 row', async () => {
      // ARRANGE
      const payload = new OrderProcessMessageDto(MOCK.seqOrderId);
      // Inject deterministic messageId so we can query processed_messages by it
      payload.messageId = MOCK.seqMessageId;

      // ACT
      await triggerConsumer(ctx, { ...payload });
      await triggerConsumer(ctx, { ...payload }); // duplicate

      // ASSERT
      const [{ count }] = await ctx.dataSource.query<{ count: string }[]>(
        `SELECT COUNT(*) AS count FROM processed_messages WHERE message_id = $1`,
        [MOCK.seqMessageId],
      );
      expect(Number(count)).toBe(1);

      // order should be PROCESSED (first call), second call must not throw
      const [order] = await ctx.dataSource.query<{ status: string }[]>(
        `SELECT status FROM orders WHERE id = $1`,
        [MOCK.seqOrderId],
      );
      expect(order.status).toBe(OrderStatus.PROCESSED);
    });
  });

  describe('concurrent duplicate (23505 unique violation)', () => {
    it('both concurrent calls resolve without throwing; exactly 1 processed_messages row', async () => {
      // ARRANGE — reset the order back to PENDING so both concurrent calls see it fresh
      await ctx.dataSource.query(`UPDATE orders SET status = 'PENDING' WHERE id = $1`, [
        MOCK.concOrderId,
      ]);

      const payload = new OrderProcessMessageDto(MOCK.concOrderId);
      payload.messageId = MOCK.concMessageId;

      // ACT — fire both calls simultaneously
      await expect(
        Promise.all([triggerConsumer(ctx, { ...payload }), triggerConsumer(ctx, { ...payload })]),
      ).resolves.not.toThrow();

      // ASSERT
      const [{ count }] = await ctx.dataSource.query<{ count: string }[]>(
        `SELECT COUNT(*) AS count FROM processed_messages WHERE message_id = $1`,
        [MOCK.concMessageId],
      );
      expect(Number(count)).toBe(1);
    });
  });
});
