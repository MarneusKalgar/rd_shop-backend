/**
 * Integration test: POST /api/v1/cart/checkout — concurrency / pessimistic locking
 *
 * 10 users each have a cart pre-seeded with 1 item of the same product (stock=5).
 * All 10 checkout requests fire in parallel; only 5 can succeed.
 *
 * Verifies:
 *  - Exactly 5 requests succeed (201)
 *  - Exactly 5 requests fail with 409 (insufficient stock under lock contention)
 *  - Final DB stock is 0
 *  - Exactly 5 orders are persisted across all 10 test users
 */
import { JwtService } from '@nestjs/jwt';
import {
  bootstrapIntegrationTest,
  IntegrationTestContext,
  teardownIntegrationTest,
} from '@test/integration/helpers/bootstrap';
import request from 'supertest';

// Unique UUID namespace for this spec: 0020xxxxxxxx
const TOTAL_STOCK = 5;
const CONCURRENT_REQUESTS = 10;

// 10 users: ...002000000001 – 002000000010
// 10 carts: ...002000000101 – 002000000110
// 10 cart-items: ...002000000201 – 002000000210
const PRODUCT_ID = 'f47ac10b-58cc-4372-a567-002000000999';
const USER_IDS = Array.from(
  { length: CONCURRENT_REQUESTS },
  (_, i) => `f47ac10b-58cc-4372-a567-0020000000${String(i + 1).padStart(2, '0')}`,
);
const CART_IDS = Array.from(
  { length: CONCURRENT_REQUESTS },
  (_, i) => `f47ac10b-58cc-4372-a567-0020000001${String(i + 1).padStart(2, '0')}`,
);
const CART_ITEM_IDS = Array.from(
  { length: CONCURRENT_REQUESTS },
  (_, i) => `f47ac10b-58cc-4372-a567-0020000002${String(i + 1).padStart(2, '0')}`,
);

const SHIPPING = {
  city: 'Kyiv',
  country: 'UA',
  firstName: 'Concurrent',
  lastName: 'User',
  postcode: '01001',
};

let ctx: IntegrationTestContext;
let accessTokens: string[];

describe('POST /api/v1/cart/checkout — pessimistic lock concurrency', () => {
  beforeAll(async () => {
    ctx = await bootstrapIntegrationTest();

    // Seed product with limited stock
    await ctx.dataSource.query(
      `INSERT INTO products (id, title, price, stock, is_active) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [PRODUCT_ID, 'Concurrency Test Product', '9.99', TOTAL_STOCK, true],
    );

    // Seed 10 users + 1 cart + 1 cart_item each (bypass addItem to avoid per-request stock checks)
    for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
      await ctx.dataSource.query(
        `INSERT INTO users (id, email, roles, scopes) VALUES ($1, $2, $3::text[], $4::text[]) ON CONFLICT (id) DO NOTHING`,
        [USER_IDS[i], `concurrency-${i}@test.local`, '{user}', '{orders:read,orders:write}'],
      );
      await ctx.dataSource.query(
        `INSERT INTO carts (id, user_id) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`,
        [CART_IDS[i], USER_IDS[i]],
      );
      await ctx.dataSource.query(
        `INSERT INTO cart_items (id, cart_id, product_id, quantity) VALUES ($1, $2, $3, 1) ON CONFLICT (cart_id, product_id) DO UPDATE SET quantity = 1`,
        [CART_ITEM_IDS[i], CART_IDS[i], PRODUCT_ID],
      );
    }

    const jwtService = ctx.app.get(JwtService);
    accessTokens = await Promise.all(
      USER_IDS.map((userId, i) =>
        jwtService.signAsync({
          email: `concurrency-${i}@test.local`,
          roles: ['user'],
          scopes: ['orders:read', 'orders:write'],
          sub: userId,
        }),
      ),
    );
  }, 90_000);

  afterAll(async () => {
    try {
      if (ctx?.dataSource) {
        await ctx.dataSource.query(
          `DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = ANY($1::uuid[]))`,
          [USER_IDS],
        );
        await ctx.dataSource.query(`DELETE FROM orders WHERE user_id = ANY($1::uuid[])`, [
          USER_IDS,
        ]);
        await ctx.dataSource.query(
          `DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE user_id = ANY($1::uuid[]))`,
          [USER_IDS],
        );
        await ctx.dataSource.query(`DELETE FROM carts WHERE user_id = ANY($1::uuid[])`, [USER_IDS]);
        await ctx.dataSource.query(`DELETE FROM products WHERE id = $1::uuid`, [PRODUCT_ID]);
        await ctx.dataSource.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [USER_IDS]);
      }
    } finally {
      await teardownIntegrationTest(ctx);
    }
  });

  it('exactly 5 of 10 concurrent checkouts succeed; final stock is 0', async () => {
    // ARRANGE — 10 users each have a cart with 1 item pre-seeded; product stock=5
    const checkoutPayload = { shipping: SHIPPING };

    // ACT — fire all checkout requests in parallel, each from a different user
    const responses = await Promise.all(
      accessTokens.map((token) =>
        request(ctx.httpServer)
          .post('/api/v1/cart/checkout')
          .set('Authorization', `Bearer ${token}`)
          .send(checkoutPayload),
      ),
    );

    // ASSERT
    const successCount = responses.filter((r) => r.status === 201).length;
    const failCount = responses.filter((r) => r.status === 409).length;

    expect(successCount).toBe(TOTAL_STOCK);
    expect(failCount).toBe(CONCURRENT_REQUESTS - TOTAL_STOCK);

    const [product] = await ctx.dataSource.query<{ stock: number }[]>(
      `SELECT stock FROM products WHERE id = $1`,
      [PRODUCT_ID],
    );
    expect(product.stock).toBe(0);

    const [{ count }] = await ctx.dataSource.query<{ count: string }[]>(
      `SELECT COUNT(*) AS count FROM orders WHERE user_id = ANY($1::uuid[])`,
      [USER_IDS],
    );
    expect(Number(count)).toBe(TOTAL_STOCK);
  });
});
