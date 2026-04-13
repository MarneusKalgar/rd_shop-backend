/**
 * Perf scenario: order cancel
 *
 * Validates B4 optimization: cancelOrder() loads relations even when cancel will be rejected.
 * Baseline: 1 SELECT with JOINs regardless of order status.
 * After fix: 1 lightweight SELECT (status only) + conditional JOIN only for valid cancellations.
 */
import {
  bootstrapPerfTest,
  getPgStatStatements,
  PerfTestContext,
  resetPgStatStatements,
  savePerfResults,
  teardownPerfTest,
} from '@test/performance/helpers/bootstrap';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { seedProducts } from '@/db/perf-seed/generate-products';
import { seedUsers } from '@/db/perf-seed/generate-users';
import { OrderStatus } from '@/orders/order.entity';

let ctx: PerfTestContext;

async function seedAlreadyCancelledOrder(
  ds: DataSource,
  userId: string,
  productId: string,
): Promise<string> {
  const [row] = await ds.query<{ id: string }[]>(
    `INSERT INTO orders (user_id, status) VALUES ($1, $2) RETURNING id`,
    [userId, OrderStatus.CANCELLED],
  );
  await ds.query(
    `INSERT INTO order_items (order_id, product_id, quantity, price_at_purchase) VALUES ($1, $2, 1, '9.99')`,
    [row.id, productId],
  );
  return row.id;
}

describe('[Perf] Order cancel — relation loading baseline', () => {
  beforeAll(async () => {
    ctx = await bootstrapPerfTest();
    await seedUsers(ctx.dataSource, 5);
    await seedProducts(ctx.dataSource, 5);
  }, 120_000);

  afterAll(() => teardownPerfTest(ctx));

  it('baseline: when cancel is rejected (already CANCELLED), logs query count', async () => {
    const [user] = await ctx.dataSource.query<{ id: string }[]>(`SELECT id FROM users LIMIT 1`);
    const [product] = await ctx.dataSource.query<{ id: string }[]>(
      `SELECT id FROM products LIMIT 1`,
    );

    const orderId = await seedAlreadyCancelledOrder(ctx.dataSource, user.id, product.id);

    // Re-sign JWT as this user
    const { JwtService } = await import('@nestjs/jwt');
    const jwtService = ctx.app.get(JwtService);
    const token = await jwtService.signAsync({
      email: `perf-user-1@test.local`,
      roles: ['user'],
      scopes: ['orders:read', 'orders:write'],
      sub: user.id,
    });

    await resetPgStatStatements(ctx.dataSource);

    await request(ctx.app.getHttpServer() as unknown as string)
      .post(`/api/v1/orders/${orderId}/cancellation`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409); // ConflictException — already cancelled

    const stats = await getPgStatStatements(ctx.dataSource, 'orders');
    const rows = stats.map((s) => ({
      calls: s.calls,
      mean_ms: s.mean_exec_time.toFixed(2),
      query: s.query,
      total_ms: s.total_exec_time.toFixed(2),
    }));
    console.log('[Baseline] Queries when cancel is rejected (CANCELLED status):');
    console.table(rows.map((r) => ({ ...r, query: r.query.slice(0, 100) })));
    savePerfResults('order-cancel-rejected-baseline', rows);

    // Baseline: 1 SELECT with JOIN to order_items + products
    // After B4: 1 SELECT without JOINs (status check only)
    expect(stats.length).toBeGreaterThanOrEqual(1);
  });
});
