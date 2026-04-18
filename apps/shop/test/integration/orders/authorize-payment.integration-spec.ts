import {
  bootstrapIntegrationTest,
  IntegrationTestContext,
  teardownIntegrationTest,
  triggerConsumer,
} from '@test/integration/helpers/bootstrap';
/**
 * Integration test: authorizePayment edge cases
 *
 * Triggered via the RabbitMQ consumer handler (same entry point as production).
 *
 * Covers:
 *  - gRPC authorize returns response with no paymentId → order stays PROCESSED,
 *    no ORDER_PAID_EVENT, no DB update to PAID
 *  - gRPC authorize throws → order stays PROCESSED, audit row ORDER_PAYMENT_FAILED,
 *    message routed to DLQ
 */
import { DataSource } from 'typeorm';

import { AuditAction } from '@/audit-log/audit-log.entity';
import { OrderProcessMessageDto } from '@/orders/dto';
import { OrderStatus } from '@/orders/order.entity';
import { MAX_RETRY_ATTEMPTS, ORDER_DLQ } from '@/rabbitmq/constants';

// Unique UUID namespace for this spec: 0060xxxxxxxx
const MOCK = {
  noPaymentIdItemId: 'f47ac10b-58cc-4372-a567-006000000201',
  noPaymentIdMessageId: 'f47ac10b-58cc-4372-a567-006000000301',
  noPaymentIdOrderId: 'f47ac10b-58cc-4372-a567-006000000101',
  productId: 'f47ac10b-58cc-4372-a567-006000000002',
  throwItemId: 'f47ac10b-58cc-4372-a567-006000000202',
  throwMessageId: 'f47ac10b-58cc-4372-a567-006000000302',
  throwOrderId: 'f47ac10b-58cc-4372-a567-006000000102',
  userId: 'f47ac10b-58cc-4372-a567-006000000001',
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

describe('authorizePayment — gRPC edge cases', () => {
  beforeAll(async () => {
    ctx = await bootstrapIntegrationTest();
    process.env.RABBITMQ_DISABLE_PAYMENTS_AUTHORIZATION = 'false';

    await ctx.dataSource.query(
      `INSERT INTO users (id, email, roles, scopes) VALUES ($1, $2, $3::text[], $4::text[]) ON CONFLICT (id) DO NOTHING`,
      [MOCK.userId, 'auth-pay@test.local', '{user}', '{orders:read,orders:write}'],
    );
    await ctx.dataSource.query(
      `INSERT INTO products (id, title, price, stock, is_active) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [MOCK.productId, 'Auth Pay Product', '9.99', 50, true],
    );

    await seedPendingOrder(ctx.dataSource, MOCK.noPaymentIdOrderId, MOCK.noPaymentIdItemId);
    await seedPendingOrder(ctx.dataSource, MOCK.throwOrderId, MOCK.throwItemId);
  }, 90_000);

  afterAll(async () => {
    try {
      if (ctx?.dataSource) {
        await ctx.dataSource.query(
          `DELETE FROM processed_messages WHERE message_id = ANY($1::text[])`,
          [[MOCK.noPaymentIdMessageId, MOCK.throwMessageId]],
        );
        await ctx.dataSource.query(`DELETE FROM order_items WHERE id = ANY($1::uuid[])`, [
          [MOCK.noPaymentIdItemId, MOCK.throwItemId],
        ]);
        await ctx.dataSource.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [
          [MOCK.noPaymentIdOrderId, MOCK.throwOrderId],
        ]);
        await ctx.dataSource.query(`DELETE FROM products WHERE id = $1::uuid`, [MOCK.productId]);
        await ctx.dataSource.query(`DELETE FROM users WHERE id = $1::uuid`, [MOCK.userId]);
      }
    } finally {
      await teardownIntegrationTest(ctx);
    }
  });

  describe('gRPC returns response without paymentId', () => {
    it('order stays PROCESSED and no payment_id is stored in DB', async () => {
      // ARRANGE — authorize returns empty/missing paymentId
      ctx.paymentsGrpcMock.authorize.mockResolvedValueOnce({
        paymentId: undefined,
        status: 'PENDING',
      });

      // ACT
      await triggerConsumer(ctx, {
        ...new OrderProcessMessageDto(MOCK.noPaymentIdOrderId),
        messageId: MOCK.noPaymentIdMessageId,
      });

      // ASSERT
      const [order] = await ctx.dataSource.query<{ payment_id: null | string; status: string }[]>(
        `SELECT status, payment_id FROM orders WHERE id = $1`,
        [MOCK.noPaymentIdOrderId],
      );
      expect(order.status).toBe(OrderStatus.PROCESSED);
      expect(order.payment_id).toBeNull();
    });
  });

  describe('gRPC authorize throws', () => {
    it('order stays PROCESSED when gRPC throws; ORDER_PAYMENT_FAILED audit row written; message goes to DLQ', async () => {
      // ARRANGE — authorize throws a gRPC-style error
      const grpcError = new Error('gRPC unavailable');
      ctx.paymentsGrpcMock.authorize.mockRejectedValueOnce(grpcError);
      ctx.rabbitmqMock.publish.mockClear();

      // ACT — attempt=MAX_RETRY_ATTEMPTS skips retry delay and routes straight to DLQ
      await triggerConsumer(ctx, {
        ...new OrderProcessMessageDto(MOCK.throwOrderId),
        attempt: MAX_RETRY_ATTEMPTS,
        messageId: MOCK.throwMessageId,
      });

      // Allow fire-and-forget audit to settle
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const [order] = await ctx.dataSource.query<{ status: string }[]>(
        `SELECT status FROM orders WHERE id = $1`,
        [MOCK.throwOrderId],
      );
      expect(order.status).toBe(OrderStatus.PROCESSED);

      const auditRows = await ctx.dataSource.query<{ action: string }[]>(
        `SELECT action FROM audit_logs WHERE target_id = $1 AND action = $2`,
        [MOCK.throwOrderId, AuditAction.ORDER_PAYMENT_FAILED],
      );
      expect(auditRows.length).toBeGreaterThan(0);
      expect(auditRows[0].action).toBe(AuditAction.ORDER_PAYMENT_FAILED);
      expect(ctx.rabbitmqMock.publish).toHaveBeenCalledWith(
        ORDER_DLQ,
        expect.objectContaining({ messageId: MOCK.throwMessageId }),
        expect.any(Object),
      );
    });
  });
});
