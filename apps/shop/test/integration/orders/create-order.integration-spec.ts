/**
 * Integration test: POST /api/v1/cart/checkout — order creation via cart
 *
 * Real flow: POST /api/v1/cart/items → POST /api/v1/cart/checkout
 *
 * Covers:
 *  - Happy path: 201, PENDING status, stock decremented, RabbitMQ publish called
 *  - Idempotency key replay: same order returned, no second DB row, publish called once total
 *  - Product not found: 404 from addItem
 *  - Insufficient stock: 409 from addItem (stock=0 product)
 *  - Invalid quantity (0): 400 from addItem validation
 *  - No auth token: 401 from addItem
 */
import { JwtService } from '@nestjs/jwt';
import {
  bootstrapIntegrationTest,
  IntegrationTestContext,
  teardownIntegrationTest,
} from '@test/integration/helpers/bootstrap';
import request from 'supertest';

import { OrderStatus } from '@/orders/order.entity';

// Unique UUID namespace for this spec: 0010xxxxxxxx
const MOCK = {
  idempotencyKey: 'create-order-idem-key-001',
  inactiveProductId: 'f47ac10b-58cc-4372-a567-001000000004',
  outOfStockProductId: 'f47ac10b-58cc-4372-a567-001000000003',
  productId: 'f47ac10b-58cc-4372-a567-001000000002',
  unknownProductId: 'f47ac10b-58cc-4372-a567-001000099999',
  userId: 'f47ac10b-58cc-4372-a567-001000000001',
} as const;

const SHIPPING = {
  city: 'Kyiv',
  country: 'UA',
  firstName: 'Test',
  lastName: 'User',
  postcode: '01001',
};

let ctx: IntegrationTestContext;
let accessToken: string;

function authPost(path: string) {
  return request(ctx.httpServer).post(path).set('Authorization', `Bearer ${accessToken}`);
}

describe('POST /api/v1/cart/checkout — order creation', () => {
  beforeAll(async () => {
    ctx = await bootstrapIntegrationTest();

    await ctx.dataSource.query(
      `INSERT INTO users (id, email, roles, scopes) VALUES ($1, $2, $3::text[], $4::text[]) ON CONFLICT (id) DO NOTHING`,
      [MOCK.userId, 'create-order@test.local', '{user}', '{orders:read,orders:write}'],
    );
    await ctx.dataSource.query(
      `INSERT INTO products (id, title, price, stock, is_active) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [MOCK.productId, 'Create Order Test Product', '19.99', 100, true],
    );
    await ctx.dataSource.query(
      `INSERT INTO products (id, title, price, stock, is_active) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [MOCK.outOfStockProductId, 'Out Of Stock Product', '9.99', 0, true],
    );
    await ctx.dataSource.query(
      `INSERT INTO products (id, title, price, stock, is_active) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [MOCK.inactiveProductId, 'Inactive Product', '9.99', 10, false],
    );

    const jwtService = ctx.app.get(JwtService);
    accessToken = await jwtService.signAsync({
      email: 'create-order@test.local',
      roles: ['user'],
      scopes: ['orders:read', 'orders:write'],
      sub: MOCK.userId,
    });
  }, 90_000);

  afterAll(async () => {
    try {
      if (ctx?.dataSource) {
        await ctx.dataSource.query(
          `DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = $1::uuid)`,
          [MOCK.userId],
        );
        await ctx.dataSource.query(`DELETE FROM orders WHERE user_id = $1::uuid`, [MOCK.userId]);
        await ctx.dataSource.query(
          `DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE user_id = $1::uuid)`,
          [MOCK.userId],
        );
        await ctx.dataSource.query(`DELETE FROM carts WHERE user_id = $1::uuid`, [MOCK.userId]);
        await ctx.dataSource.query(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [
          [MOCK.productId, MOCK.outOfStockProductId, MOCK.inactiveProductId],
        ]);
        await ctx.dataSource.query(`DELETE FROM users WHERE id = $1::uuid`, [MOCK.userId]);
      }
    } finally {
      await teardownIntegrationTest(ctx);
    }
  });

  beforeEach(async () => {
    // Clear cart before each test so each test starts with an empty cart
    await request(ctx.httpServer)
      .delete('/api/v1/cart')
      .set('Authorization', `Bearer ${accessToken}`);
    ctx.rabbitmqMock.publish.mockClear();
  });

  describe('happy path', () => {
    it('returns 201 with PENDING status and decrements product stock', async () => {
      // ARRANGE
      const [before] = await ctx.dataSource.query<{ stock: number }[]>(
        `SELECT stock FROM products WHERE id = $1`,
        [MOCK.productId],
      );

      await authPost('/api/v1/cart/items')
        .send({ productId: MOCK.productId, quantity: 2 })
        .expect(201);

      // ACT
      const res = await authPost('/api/v1/cart/checkout').send({ shipping: SHIPPING }).expect(201);

      // ASSERT
      const body = res.body as { data: { id: string; status: string } };
      expect(body.data.id).toBeTruthy();
      expect(body.data.status).toBe(OrderStatus.PENDING);

      const [after] = await ctx.dataSource.query<{ stock: number }[]>(
        `SELECT stock FROM products WHERE id = $1`,
        [MOCK.productId],
      );
      expect(Number(after.stock)).toBe(Number(before.stock) - 2);

      expect(ctx.rabbitmqMock.publish).toHaveBeenCalledTimes(1);
    });
  });

  describe('idempotency', () => {
    it('returns same order on duplicate idempotencyKey, publish called once total', async () => {
      // ARRANGE — first checkout
      await authPost('/api/v1/cart/items')
        .send({ productId: MOCK.productId, quantity: 1 })
        .expect(201);

      const firstRes = await authPost('/api/v1/cart/checkout')
        .send({ idempotencyKey: MOCK.idempotencyKey, shipping: SHIPPING })
        .expect(201);
      const firstOrderId = (firstRes.body as { data: { id: string } }).data.id;

      // ACT — re-add item, replay with same idempotencyKey
      await authPost('/api/v1/cart/items')
        .send({ productId: MOCK.productId, quantity: 1 })
        .expect(201);

      const secondRes = await authPost('/api/v1/cart/checkout')
        .send({ idempotencyKey: MOCK.idempotencyKey, shipping: SHIPPING })
        .expect(201);

      // ASSERT
      expect((secondRes.body as { data: { id: string } }).data.id).toBe(firstOrderId);

      const [{ count }] = await ctx.dataSource.query<{ count: string }[]>(
        `SELECT COUNT(*) AS count FROM orders WHERE idempotency_key = $1`,
        [MOCK.idempotencyKey],
      );
      expect(Number(count)).toBe(1);

      expect(ctx.rabbitmqMock.publish).toHaveBeenCalledTimes(1);
    });
  });

  describe('product validation', () => {
    it('returns 404 when product does not exist', async () => {
      // ARRANGE / ACT / ASSERT
      await authPost('/api/v1/cart/items')
        .send({ productId: MOCK.unknownProductId, quantity: 1 })
        .expect(404);
    });

    it('returns 409 when product is out of stock', async () => {
      // ARRANGE / ACT / ASSERT
      await authPost('/api/v1/cart/items')
        .send({ productId: MOCK.outOfStockProductId, quantity: 1 })
        .expect(409);
    });

    it('returns 409 when product is inactive', async () => {
      // ARRANGE / ACT / ASSERT
      await authPost('/api/v1/cart/items')
        .send({ productId: MOCK.inactiveProductId, quantity: 1 })
        .expect(409);
    });
  });

  describe('invalid input', () => {
    it('returns 400 when item quantity is 0', async () => {
      // ARRANGE / ACT / ASSERT — @Min(1) on AddCartItemDto.quantity
      await authPost('/api/v1/cart/items')
        .send({ productId: MOCK.productId, quantity: 0 })
        .expect(400);
    });
  });

  describe('authentication', () => {
    it('returns 401 when no auth token is provided', async () => {
      // ARRANGE / ACT / ASSERT
      await request(ctx.httpServer)
        .post('/api/v1/cart/items')
        .send({ productId: MOCK.productId, quantity: 1 })
        .expect(401);
    });
  });
});
