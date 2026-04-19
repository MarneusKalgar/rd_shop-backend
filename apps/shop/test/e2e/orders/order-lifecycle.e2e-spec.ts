import { addToCartAndCheckout, poll, signupAndSignin, waitForReady } from '@test/e2e/helpers';
import supertest from 'supertest';

import { BASE_URL } from './constants';
import { OrderBody, PaymentBody, ProductBody } from './interfaces';

const E2E_USER_EMAIL = 'e2e-order-test@example.com';
const E2E_USER_PASSWORD = 'E2eTestPass1!';

describe('Order lifecycle (e2e)', () => {
  let token: string;
  let productId: string;

  beforeAll(async () => {
    await waitForReady(`${BASE_URL}/health`);

    const ts = await signupAndSignin(E2E_USER_EMAIL, E2E_USER_PASSWORD);
    token = ts.accessToken;

    const res = await supertest(BASE_URL).get('/api/v1/products').expect(200);
    const { data: products } = res.body as unknown as { data: ProductBody[] };
    // Require stock >= 3: Flow 1 uses 1, Flow 2 uses 1, Flow 3 uses 1 (idempotent second call is free)
    const available = products.find((p) => p.stock >= 3);
    if (!available) throw new Error('No product with stock >= 3 found in seed data');
    productId = available.id;
  }, 130_000);

  // ──────────────────────────────────────────────────────────────────────────
  // Flow 1: Happy path — order goes from PENDING → PAID
  // ──────────────────────────────────────────────────────────────────────────

  describe('Flow 1: happy path — order reaches PAID', () => {
    let orderId: string;

    it('creates an order via cart and receives PENDING status', async () => {
      const { orderId: id, status } = await addToCartAndCheckout(token, productId);
      orderId = id;
      expect(status).toBe('PENDING');
    });

    it('order transitions to PAID', async () => {
      // Not flaky: with RABBITMQ_SIMULATE_DELAY=0, the worker picks up the message within
      // seconds. 30s × 1s intervals gives 30 retries — more than enough for a healthy stack.
      const order = await poll(
        async () => {
          const r = await supertest(BASE_URL)
            .get(`/api/v1/orders/${orderId}`)
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
      const res = await supertest(BASE_URL)
        .get(`/api/v1/orders/${orderId}/payment`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const { data } = res.body as unknown as { data: PaymentBody };
      expect(data.paymentId.length).toBeGreaterThan(0);
      expect(['AUTHORIZED', 'CAPTURED', 'PENDING', 'FAILED']).toContain(data.status);
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
      const productRes = await supertest(BASE_URL).get(`/api/v1/products/${productId}`).expect(200);
      const { data: product } = productRes.body as unknown as { data: ProductBody };
      stockBefore = product.stock;

      ({ orderId } = await addToCartAndCheckout(token, productId));

      // Wait for PAID before cancelling — PAID is the most realistic pre-cancel state
      await poll(
        async () => {
          const r = await supertest(BASE_URL)
            .get(`/api/v1/orders/${orderId}`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200);
          return (r.body as unknown as { data: OrderBody }).data;
        },
        (o) => o.status === 'PAID',
        30_000,
        1_000,
      );

      const cancelRes = await supertest(BASE_URL)
        .post(`/api/v1/orders/${orderId}/cancellation`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      cancelledOrder = (cancelRes.body as unknown as { data: OrderBody }).data;
    }, 50_000);

    it('cancelled order has status CANCELLED', () => {
      expect(cancelledOrder.status).toBe('CANCELLED');
      expect(cancelledOrder.id).toBe(orderId);
    });

    it('product stock is restored to pre-order level after cancellation', async () => {
      const res = await supertest(BASE_URL).get(`/api/v1/products/${productId}`).expect(200);
      const { data: product } = res.body as unknown as { data: ProductBody };
      expect(product.stock).toBe(stockBefore);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Flow 3: Idempotency key — sequential retries return the same order
  // ──────────────────────────────────────────────────────────────────────────

  describe('Flow 3: idempotency key deduplicates repeated checkout requests', () => {
    it('second checkout with same idempotencyKey returns the same order ID', async () => {
      const idempotencyKey = `e2e-idem-${Date.now()}`;

      // First checkout — creates the order
      const first = await addToCartAndCheckout(token, productId, 1, idempotencyKey);

      // Second checkout — service finds existing order by key, returns it without double-creating
      const second = await addToCartAndCheckout(token, productId, 1, idempotencyKey);

      expect(second.orderId).toBe(first.orderId);
    });
  });
});
