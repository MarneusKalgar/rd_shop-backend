import { addToCartAndCheckout, signupAndSignin, waitForReady } from '@test/e2e/helpers';
import supertest from 'supertest';

import { BASE_URL } from './constants';
import { OrderBody, OrdersListBody, ProductBody } from './interfaces';

const E2E_USER_EMAIL = 'e2e-orders-query@example.com';
const E2E_USER_PASSWORD = 'E2eQueryPass1!';

describe('Order querying (e2e)', () => {
  let token: string;
  let productId: string;
  let orderId1: string;
  let orderId2: string;

  beforeAll(async () => {
    await waitForReady(`${BASE_URL}/health`);

    const ts = await signupAndSignin(E2E_USER_EMAIL, E2E_USER_PASSWORD);
    token = ts.accessToken;

    const res = await supertest(BASE_URL).get('/api/v1/products').expect(200);
    const { data: products } = res.body as unknown as { data: ProductBody[] };
    const available = products.find((p) => p.stock >= 2);
    if (!available) throw new Error('No product with stock >= 2 found in seed data');
    productId = available.id;

    const checkout1 = await addToCartAndCheckout(token, productId);
    const checkout2 = await addToCartAndCheckout(token, productId);

    orderId1 = checkout1.orderId;
    orderId2 = checkout2.orderId;
  }, 130_000);

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/v1/orders — list with pagination
  // ──────────────────────────────────────────────────────────────────────────

  describe('GET /api/v1/orders', () => {
    it('includes both created orders', async () => {
      const res = await supertest(BASE_URL)
        .get('/api/v1/orders')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const { data } = res.body as unknown as OrdersListBody;
      const ids = data.map((o) => o.id);
      expect(ids).toContain(orderId1);
      expect(ids).toContain(orderId2);
    });

    it('respects the limit query param and returns nextCursor when more records exist', async () => {
      const res = await supertest(BASE_URL)
        .get('/api/v1/orders?limit=1')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as unknown as OrdersListBody;
      expect(body.data).toHaveLength(1);
      expect(body.limit).toBe(1);
      // There are at least 2 orders so a cursor must be present
      expect(body.nextCursor).toBeTruthy();
    });

    it('cursor pagination: second page returns a different order', async () => {
      const firstPageRes = await supertest(BASE_URL)
        .get('/api/v1/orders?limit=1')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const { data: firstData, nextCursor } = firstPageRes.body as unknown as OrdersListBody;
      expect(nextCursor).toBeTruthy();

      const secondPageRes = await supertest(BASE_URL)
        .get(`/api/v1/orders?limit=1&cursor=${nextCursor!}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const { data: secondData } = secondPageRes.body as unknown as OrdersListBody;
      expect(secondData).toHaveLength(1);
      expect(secondData[0]?.id).not.toBe(firstData[0]?.id);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/v1/orders/:orderId — single order
  // ──────────────────────────────────────────────────────────────────────────

  describe('GET /api/v1/orders/:orderId', () => {
    it('returns the correct order with items', async () => {
      const res = await supertest(BASE_URL)
        .get(`/api/v1/orders/${orderId1}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const { data } = res.body as unknown as { data: OrderBody };
      expect(data.id).toBe(orderId1);
      expect(data.items.length).toBeGreaterThan(0);
    });

    it('returns 404 for a non-existent order ID', async () => {
      await supertest(BASE_URL)
        .get('/api/v1/orders/00000000-0000-4000-8000-000000000001')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('returns 401 without an auth token', async () => {
      await supertest(BASE_URL).get(`/api/v1/orders/${orderId1}`).expect(401);
    });
  });

  afterAll(async () => {
    for (const id of [orderId1, orderId2]) {
      await supertest(BASE_URL)
        .post(`/api/v1/orders/${id}/cancellation`)
        .set('Authorization', `Bearer ${token}`)
        .catch(() => undefined);
    }
  });
});
