import { addToCartAndCheckout, BASE_URL, signupAndSignin, waitForReady } from '@test/e2e/helpers';
import supertest from 'supertest';
const E2E_USER_EMAIL = 'e2e-cart-test@example.com';
const E2E_USER_PASSWORD = 'E2eCartPass1!';

interface CartBody {
  id: string;
  items: CartItemBody[];
  total: string;
  userId: string;
}

interface CartItemBody {
  id: string;
  itemTotal: string;
  productId: string;
  quantity: number;
}

describe('Cart flow (e2e)', () => {
  let token: string;
  let productId: string;

  beforeAll(async () => {
    await waitForReady(`${BASE_URL}/health`);

    const ts = await signupAndSignin(E2E_USER_EMAIL, E2E_USER_PASSWORD);
    token = ts.accessToken;

    const res = await supertest(BASE_URL).get('/api/v1/products').expect(200);
    const { data: products } = res.body as unknown as {
      data: { id: string; stock: number }[];
    };
    // Require stock >= 5 to accommodate multiple flows without running out
    const available = products.find((p) => p.stock >= 5);
    if (!available) throw new Error('No product with stock >= 5 found in seed data');
    productId = available.id;
  }, 130_000);

  afterEach(async () => {
    await supertest(BASE_URL)
      .delete('/api/v1/cart')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Flow 1: Cart CRUD
  // ──────────────────────────────────────────────────────────────────────────

  describe('Flow 1: cart item management', () => {
    it('adds an item to cart and returns cart with that item', async () => {
      const res = await supertest(BASE_URL)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ productId, quantity: 1 })
        .expect(201);

      const { data } = res.body as unknown as { data: CartBody };
      expect(data.items).toHaveLength(1);
      expect(data.items[0]?.productId).toBe(productId);
      expect(data.items[0]?.quantity).toBe(1);
    });

    it('adding same product again increments quantity (upsert)', async () => {
      await supertest(BASE_URL)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ productId, quantity: 1 })
        .expect(201);

      const res = await supertest(BASE_URL)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ productId, quantity: 2 })
        .expect(201);

      const { data } = res.body as unknown as { data: CartBody };
      expect(data.items).toHaveLength(1);
      expect(data.items[0]?.quantity).toBe(3);
    });

    it('GET /cart returns the current cart', async () => {
      await supertest(BASE_URL)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ productId, quantity: 1 })
        .expect(201);

      const res = await supertest(BASE_URL)
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const { data } = res.body as unknown as { data: CartBody };
      expect(data.items).toHaveLength(1);
      expect(data.items[0]?.productId).toBe(productId);
    });

    it('updates item quantity via PATCH /cart/items/:itemId', async () => {
      const addRes = await supertest(BASE_URL)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ productId, quantity: 1 })
        .expect(201);

      const { data: cartAfterAdd } = addRes.body as unknown as { data: CartBody };
      const itemId = cartAfterAdd.items[0].id;

      const res = await supertest(BASE_URL)
        .patch(`/api/v1/cart/items/${itemId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ quantity: 2 })
        .expect(200);

      const { data } = res.body as unknown as { data: CartBody };
      expect(data.items[0]?.quantity).toBe(2);
    });

    it('removes a specific item via DELETE /cart/items/:itemId', async () => {
      const addRes = await supertest(BASE_URL)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ productId, quantity: 1 })
        .expect(201);

      const { data: cartAfterAdd } = addRes.body as unknown as { data: CartBody };
      const itemId = cartAfterAdd.items[0].id;

      const res = await supertest(BASE_URL)
        .delete(`/api/v1/cart/items/${itemId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const { data } = res.body as unknown as { data: CartBody };
      expect(data.items).toHaveLength(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Flow 2: addToCartAndCheckout helper — validates the full cart checkout path
  // ──────────────────────────────────────────────────────────────────────────

  describe('Flow 2: checkout creates an order and empties the cart', () => {
    const flow2OrderIds: string[] = [];

    it('addToCartAndCheckout returns a PENDING order with the correct item', async () => {
      const { orderId, status } = await addToCartAndCheckout(token, productId, 1);
      flow2OrderIds.push(orderId);
      expect(status).toBe('PENDING');

      const orderRes = await supertest(BASE_URL)
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const { data: order } = orderRes.body as unknown as {
        data: { id: string; items: { productId: string; quantity: number }[]; status: string };
      };
      expect(order.id).toBe(orderId);
      expect(order.items).toHaveLength(1);
      expect(order.items[0]?.productId).toBe(productId);
      expect(order.items[0]?.quantity).toBe(1);
    });

    it('cart is empty after checkout', async () => {
      // addToCartAndCheckout clears the cart, adds item, checks out — cart is cleared by the service
      const { orderId } = await addToCartAndCheckout(token, productId, 1);
      flow2OrderIds.push(orderId);

      const res = await supertest(BASE_URL)
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const { data } = res.body as unknown as { data: CartBody };
      expect(data.items).toHaveLength(0);
    });

    afterAll(async () => {
      for (const id of flow2OrderIds) {
        await supertest(BASE_URL)
          .post(`/api/v1/orders/${id}/cancellation`)
          .set('Authorization', `Bearer ${token}`)
          .catch(() => undefined);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Flow 3: Error cases
  // ──────────────────────────────────────────────────────────────────────────

  describe('Flow 3: error cases', () => {
    it('POST /cart/checkout with an empty cart returns 400', async () => {
      await supertest(BASE_URL)
        .post('/api/v1/cart/checkout')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(400);
    });
  });
});
