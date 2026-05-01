import {
  addToCartAndCheckout,
  e2eRequest,
  getScenarioUserEmail,
  getScenarioUserPassword,
  poll,
  prefixValidationKey,
  resolveE2EProductId,
  signupAndSignin,
  waitForReady,
} from '@test/e2e/helpers';

import { BASE_URL } from './constants';
import { OrderBody, PaymentBody, ProductBody } from './interfaces';

const SCENARIO_USER_EMAIL = getScenarioUserEmail('order', 'e2e-order-test@example.com');
const SCENARIO_USER_PASSWORD = getScenarioUserPassword('E2eTestPass1!');

describe('Order lifecycle (e2e)', () => {
  let token: string;
  let productId: string;

  beforeAll(async () => {
    await waitForReady(`${BASE_URL}/health`);

    const ts = await signupAndSignin(SCENARIO_USER_EMAIL, SCENARIO_USER_PASSWORD);
    token = ts.accessToken;

    productId = await resolveE2EProductId(3);
  }, 130_000);

  // ──────────────────────────────────────────────────────────────────────────
  // Flow 1: Happy path — order goes from PENDING → PAID
  // ──────────────────────────────────────────────────────────────────────────

  describe('Flow 1: happy path — order reaches PAID', () => {
    let orderId: string;
    let stockBefore: number;

    it('creates an order via cart and receives PENDING status', async () => {
      const productRes = await e2eRequest('get', `/api/v1/products/${productId}`).expect(200);
      stockBefore = (productRes.body as unknown as { data: ProductBody }).data.stock;

      const { orderId: id, status } = await addToCartAndCheckout(token, productId);
      orderId = id;
      expect(status).toBe('PENDING');
    });

    it('order transitions to PAID', async () => {
      // Not flaky: with RABBITMQ_SIMULATE_DELAY=0, the worker picks up the message within
      // seconds. 30s × 1s intervals gives 30 retries — more than enough for a healthy stack.
      const order = await poll(
        async () => {
          const r = await e2eRequest('get', `/api/v1/orders/${orderId}`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200);
          return (r.body as unknown as { data: OrderBody }).data;
        },
        (o) => o.status === 'PAID',
        30_000,
        1_000,
      );

      expect(order.status).toBe('PAID');
    }, 35_000);

    it('GET /orders/:id/payment returns payment info with correct structure', async () => {
      const res = await e2eRequest('get', `/api/v1/orders/${orderId}/payment`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const { data } = res.body as unknown as { data: PaymentBody };
      expect(data.paymentId.length).toBeGreaterThan(0);
      expect(data.status).toBe('AUTHORIZED');
    });

    it('product stock is decremented by 1 after order reaches PAID', async () => {
      const res = await e2eRequest('get', `/api/v1/products/${productId}`).expect(200);
      const { data: product } = res.body as unknown as { data: ProductBody };
      expect(product.stock).toBe(stockBefore - 1);
    });

    afterAll(async () => {
      if (orderId) {
        await e2eRequest('post', `/api/v1/orders/${orderId}/cancellation`)
          .set('Authorization', `Bearer ${token}`)
          .catch(() => undefined);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Flow 2: Cancel a PAID order — stock restored
  // ──────────────────────────────────────────────────────────────────────────

  describe('Flow 2: cancel a PAID order, stock is restored', () => {
    let orderId: string;
    let cancelledOrder: OrderBody;
    let stockBefore: number;

    beforeAll(async () => {
      // Capture stock before this flow's order creation (after Flow 1 has decremented once)
      const productRes = await e2eRequest('get', `/api/v1/products/${productId}`).expect(200);
      const { data: product } = productRes.body as unknown as { data: ProductBody };
      stockBefore = product.stock;

      ({ orderId } = await addToCartAndCheckout(token, productId));

      // Wait for PAID before cancelling — PAID is the most realistic pre-cancel state
      await poll(
        async () => {
          const r = await e2eRequest('get', `/api/v1/orders/${orderId}`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200);
          return (r.body as unknown as { data: OrderBody }).data;
        },
        (o) => o.status === 'PAID',
        30_000,
        1_000,
      );

      const cancelRes = await e2eRequest('post', `/api/v1/orders/${orderId}/cancellation`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      cancelledOrder = (cancelRes.body as unknown as { data: OrderBody }).data;
    }, 50_000);

    it('cancelled order has status CANCELLED', () => {
      expect(cancelledOrder.status).toBe('CANCELLED');
      expect(cancelledOrder.id).toBe(orderId);
    });

    it('product stock is restored to pre-order level after cancellation', async () => {
      const res = await e2eRequest('get', `/api/v1/products/${productId}`).expect(200);
      const { data: product } = res.body as unknown as { data: ProductBody };
      expect(product.stock).toBe(stockBefore);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Flow 3: Idempotency key — sequential retries return the same order
  // ──────────────────────────────────────────────────────────────────────────

  describe('Flow 3: idempotency key deduplicates repeated checkout requests', () => {
    let flow3OrderId: string | undefined;

    it('second checkout with same idempotencyKey returns the same order ID', async () => {
      const idempotencyKey = prefixValidationKey(`e2e-idem-${Date.now()}`);

      // First checkout — creates the order
      const first = await addToCartAndCheckout(token, productId, 1, idempotencyKey);
      flow3OrderId = first.orderId;

      // Second checkout — service finds existing order by key, returns it without double-creating
      const second = await addToCartAndCheckout(token, productId, 1, idempotencyKey);

      expect(second.orderId).toBe(first.orderId);
    });

    afterAll(async () => {
      if (flow3OrderId) {
        await e2eRequest('post', `/api/v1/orders/${flow3OrderId}/cancellation`)
          .set('Authorization', `Bearer ${token}`)
          .catch(() => undefined);
      }
    });
  });
});
