/**
 * Integration test: GET /api/v1/orders/:orderId/payment — getOrderPayment
 *
 * Covers:
 *  - Order with no paymentId → 400
 *  - Order not belonging to requesting user → 404
 *  - Order with paymentId, gRPC mock returns status → 200 with { paymentId, status }
 */
import { JwtService } from '@nestjs/jwt';
import {
  bootstrapIntegrationTest,
  IntegrationTestContext,
  teardownIntegrationTest,
} from '@test/integration/helpers/bootstrap';
import request from 'supertest';

// Unique UUID namespace for this spec: 0080xxxxxxxx
const MOCK = {
  noPaymentItemId: 'f47ac10b-58cc-4372-a567-008000000201',
  noPaymentOrderId: 'f47ac10b-58cc-4372-a567-008000000101',
  otherUserId: 'f47ac10b-58cc-4372-a567-008000000002',
  otherUserItemId: 'f47ac10b-58cc-4372-a567-008000000203',
  otherUserOrderId: 'f47ac10b-58cc-4372-a567-008000000103',
  paidItemId: 'f47ac10b-58cc-4372-a567-008000000202',
  paidOrderId: 'f47ac10b-58cc-4372-a567-008000000102',
  productId: 'f47ac10b-58cc-4372-a567-008000000003',
  userId: 'f47ac10b-58cc-4372-a567-008000000001',
} as const;

const FAKE_PAYMENT_ID = 'pay_get_payment_test_001';
const FAKE_PAYMENT_STATUS = 'COMPLETED';

let ctx: IntegrationTestContext;
let accessToken: string;

describe('GET /api/v1/orders/:orderId/payment', () => {
  beforeAll(async () => {
    ctx = await bootstrapIntegrationTest();
    ctx.paymentsGrpcMock.getPaymentStatus.mockResolvedValue({
      paymentId: FAKE_PAYMENT_ID,
      status: FAKE_PAYMENT_STATUS,
    });

    await ctx.dataSource.query(
      `INSERT INTO users (id, email, roles, scopes) VALUES ($1, $2, $3::text[], $4::text[]) ON CONFLICT (id) DO NOTHING`,
      [MOCK.userId, 'get-payment@test.local', '{user}', '{orders:read,orders:write}'],
    );
    await ctx.dataSource.query(
      `INSERT INTO users (id, email, roles, scopes) VALUES ($1, $2, $3::text[], $4::text[]) ON CONFLICT (id) DO NOTHING`,
      [MOCK.otherUserId, 'get-payment-other@test.local', '{user}', '{orders:read,orders:write}'],
    );
    await ctx.dataSource.query(
      `INSERT INTO products (id, title, price, stock, is_active) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [MOCK.productId, 'Get Payment Product', '9.99', 50, true],
    );

    // Order without a paymentId (PENDING)
    await ctx.dataSource.query(
      `INSERT INTO orders (id, user_id, status) VALUES ($1, $2, 'PENDING') ON CONFLICT (id) DO NOTHING`,
      [MOCK.noPaymentOrderId, MOCK.userId],
    );
    await ctx.dataSource.query(
      `INSERT INTO order_items (id, order_id, product_id, quantity, price_at_purchase)
       VALUES ($1, $2, $3, 1, '9.99') ON CONFLICT (id) DO NOTHING`,
      [MOCK.noPaymentItemId, MOCK.noPaymentOrderId, MOCK.productId],
    );

    // Order with a paymentId (PAID)
    await ctx.dataSource.query(
      `INSERT INTO orders (id, user_id, status, payment_id) VALUES ($1, $2, 'PAID', $3) ON CONFLICT (id) DO NOTHING`,
      [MOCK.paidOrderId, MOCK.userId, FAKE_PAYMENT_ID],
    );
    await ctx.dataSource.query(
      `INSERT INTO order_items (id, order_id, product_id, quantity, price_at_purchase)
       VALUES ($1, $2, $3, 1, '9.99') ON CONFLICT (id) DO NOTHING`,
      [MOCK.paidItemId, MOCK.paidOrderId, MOCK.productId],
    );

    // Another user's order
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
      email: 'get-payment@test.local',
      roles: ['user'],
      scopes: ['orders:read', 'orders:write'],
      sub: MOCK.userId,
    });
  }, 90_000);

  afterAll(async () => {
    try {
      if (ctx?.dataSource) {
        const allItemIds = [MOCK.noPaymentItemId, MOCK.paidItemId, MOCK.otherUserItemId];
        const allOrderIds = [MOCK.noPaymentOrderId, MOCK.paidOrderId, MOCK.otherUserOrderId];
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

  describe('order has no associated payment', () => {
    it('returns 400 when order has no paymentId', async () => {
      // ARRANGE — noPaymentOrderId has no payment_id in DB

      // ACT & ASSERT
      await request(ctx.httpServer)
        .get(`/api/v1/orders/${MOCK.noPaymentOrderId}/payment`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);
    });
  });

  describe('order ownership', () => {
    it('returns 404 when order does not belong to authenticated user', async () => {
      // ARRANGE — otherUserOrderId belongs to otherUserId, not userId

      // ACT & ASSERT
      await request(ctx.httpServer)
        .get(`/api/v1/orders/${MOCK.otherUserOrderId}/payment`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });
  });

  describe('happy path', () => {
    it('returns 200 with paymentId and status from gRPC mock', async () => {
      // ARRANGE — paidOrderId has payment_id set; gRPC mock returns COMPLETED

      // ACT
      const response = await request(ctx.httpServer)
        .get(`/api/v1/orders/${MOCK.paidOrderId}/payment`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // ASSERT
      const body = response.body as { data: { paymentId: string; status: string } };
      expect(body.data.paymentId).toBe(FAKE_PAYMENT_ID);
      expect(body.data.status).toBe(FAKE_PAYMENT_STATUS);
      expect(ctx.paymentsGrpcMock.getPaymentStatus).toHaveBeenCalledWith(FAKE_PAYMENT_ID);
    });
  });
});
