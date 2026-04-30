import {
  bootstrapIntegrationTest,
  IntegrationTestContext,
  teardownIntegrationTest,
  triggerConsumer,
} from '@test/integration/helpers/bootstrap';
/**
 * Integration test: OrderWorkerService consumer — happy path + DISABLE_PAYMENTS_AUTHORIZATION
 *
 * Triggered via the RabbitMQ consumer handler (same entry point as production).
 * Treats OrderWorkerService + OrdersService as a black box.
 *
 * Covers:
 *  - Happy path: PENDING → PROCESSED → paymentsGrpcService.authorize called → PAID, paymentId stored
 *  - audit_logs row for ORDER_PAYMENT_AUTHORIZED exists after successful payment
 *  - RABBITMQ_DISABLE_PAYMENTS_AUTHORIZATION=true → order stays PROCESSED, authorize NOT called
 */
import { DataSource } from 'typeorm';

import { AuditAction } from '@/audit-log/audit-log.entity';
import { OrderProcessMessageDto } from '@/orders/dto';
import { OrderStatus } from '@/orders/order.entity';

// Unique UUID namespace for this spec: 0040xxxxxxxx
const MOCK = {
  disabledPaymentsItemId: 'f47ac10b-58cc-4372-a567-004000000202',
  disabledPaymentsOrderId: 'f47ac10b-58cc-4372-a567-004000000102',
  pendingItemId: 'f47ac10b-58cc-4372-a567-004000000201',
  pendingOrderId: 'f47ac10b-58cc-4372-a567-004000000101',
  productId: 'f47ac10b-58cc-4372-a567-004000000002',
  userId: 'f47ac10b-58cc-4372-a567-004000000001',
} as const;

const FAKE_PAYMENT_ID = 'pay_integration_test_001';

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

describe('OrderWorkerService consumer — happy path', () => {
  beforeAll(async () => {
    ctx = await bootstrapIntegrationTest();
    // Ensure payments authorization is enabled for the happy-path suite
    process.env.RABBITMQ_DISABLE_PAYMENTS_AUTHORIZATION = 'false';
    ctx.paymentsGrpcMock.authorize.mockResolvedValue({
      paymentId: FAKE_PAYMENT_ID,
      status: 'COMPLETED',
    });

    await ctx.dataSource.query(
      `INSERT INTO users (id, email, roles, scopes) VALUES ($1, $2, $3::text[], $4::text[]) ON CONFLICT (id) DO NOTHING`,
      [MOCK.userId, 'process-msg@test.local', '{user}', '{orders:read,orders:write}'],
    );
    await ctx.dataSource.query(
      `INSERT INTO products (id, title, price, stock, is_active) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [MOCK.productId, 'Process Msg Product', '9.99', 50, true],
    );

    await seedPendingOrder(ctx.dataSource, MOCK.pendingOrderId, MOCK.pendingItemId);
    await seedPendingOrder(
      ctx.dataSource,
      MOCK.disabledPaymentsOrderId,
      MOCK.disabledPaymentsItemId,
    );
  }, 90_000);

  afterAll(async () => {
    try {
      if (ctx?.dataSource) {
        await ctx.dataSource.query(
          `DELETE FROM processed_messages WHERE order_id = ANY($1::text[])`,
          [[MOCK.pendingOrderId, MOCK.disabledPaymentsOrderId]],
        );
        await ctx.dataSource.query(`DELETE FROM order_items WHERE id = ANY($1::uuid[])`, [
          [MOCK.pendingItemId, MOCK.disabledPaymentsItemId],
        ]);
        await ctx.dataSource.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [
          [MOCK.pendingOrderId, MOCK.disabledPaymentsOrderId],
        ]);
        await ctx.dataSource.query(`DELETE FROM products WHERE id = $1::uuid`, [MOCK.productId]);
        await ctx.dataSource.query(`DELETE FROM users WHERE id = $1::uuid`, [MOCK.userId]);
      }
    } finally {
      await teardownIntegrationTest(ctx);
    }
  });

  describe('happy path with payments enabled', () => {
    it('transitions PENDING → PROCESSED → PAID and stores paymentId', async () => {
      // ACT
      await triggerConsumer(ctx, new OrderProcessMessageDto(MOCK.pendingOrderId));

      // Allow fire-and-forget audit to settle
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      // ASSERT
      const [order] = await ctx.dataSource.query<{ payment_id: string; status: string }[]>(
        `SELECT status, payment_id FROM orders WHERE id = $1`,
        [MOCK.pendingOrderId],
      );
      expect(order.status).toBe(OrderStatus.PAID);
      expect(order.payment_id).toBe(FAKE_PAYMENT_ID);

      expect(ctx.paymentsGrpcMock.authorize).toHaveBeenCalledTimes(1);
      const authorizeCall = ctx.paymentsGrpcMock.authorize.mock.calls[0] as [unknown, ...unknown[]];
      expect(authorizeCall[0]).toEqual(
        expect.objectContaining({ currency: 'USD', orderId: MOCK.pendingOrderId }),
      );
    });

    it('creates an ORDER_PAYMENT_AUTHORIZED audit log row', async () => {
      // ARRANGE — seed a dedicated order so this test is self-contained
      const auditOrderId = 'f47ac10b-58cc-4372-a567-004000000103';
      const auditItemId = 'f47ac10b-58cc-4372-a567-004000000203';
      await seedPendingOrder(ctx.dataSource, auditOrderId, auditItemId);

      // Use a unique paymentId — 'pay_integration_test_001' is already taken by pendingOrderId
      ctx.paymentsGrpcMock.authorize.mockResolvedValueOnce({
        paymentId: 'pay_integration_test_audit_001',
        status: 'COMPLETED',
      });

      // ACT
      await triggerConsumer(ctx, new OrderProcessMessageDto(auditOrderId));

      // Allow fire-and-forget audit to settle
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      // ASSERT
      const [auditRow] = await ctx.dataSource.query<{ action: string }[]>(
        `SELECT action FROM audit_logs WHERE target_id = $1 AND action = $2`,
        [auditOrderId, AuditAction.ORDER_PAYMENT_AUTHORIZED],
      );
      expect(auditRow).toBeDefined();
      expect(auditRow.action).toBe(AuditAction.ORDER_PAYMENT_AUTHORIZED);

      // Cleanup
      await ctx.dataSource.query(`DELETE FROM processed_messages WHERE order_id = $1`, [
        auditOrderId,
      ]);
      await ctx.dataSource.query(`DELETE FROM order_items WHERE id = $1::uuid`, [auditItemId]);
      await ctx.dataSource.query(`DELETE FROM orders WHERE id = $1::uuid`, [auditOrderId]);
    });
  });

  describe('RABBITMQ_DISABLE_PAYMENTS_AUTHORIZATION=true', () => {
    it('leaves order in PROCESSED status and does not call authorize', async () => {
      // ARRANGE
      process.env.RABBITMQ_DISABLE_PAYMENTS_AUTHORIZATION = 'true';
      ctx.paymentsGrpcMock.authorize.mockClear();

      // ACT
      await triggerConsumer(ctx, new OrderProcessMessageDto(MOCK.disabledPaymentsOrderId));

      // ASSERT
      const [order] = await ctx.dataSource.query<{ status: string }[]>(
        `SELECT status FROM orders WHERE id = $1`,
        [MOCK.disabledPaymentsOrderId],
      );
      expect(order.status).toBe(OrderStatus.PROCESSED);
      expect(ctx.paymentsGrpcMock.authorize).not.toHaveBeenCalled();

      // Cleanup env
      process.env.RABBITMQ_DISABLE_PAYMENTS_AUTHORIZATION = 'false';
    });
  });
});
