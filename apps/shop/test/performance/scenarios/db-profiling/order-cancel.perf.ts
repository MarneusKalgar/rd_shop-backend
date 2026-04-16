/**
 * Perf scenario: order cancel — AFTER B4
 *
 * Validates that cancelOrder() no longer loads items + products when the cancel
 * is rejected early (wrong status). Only a status-check SELECT should fire.
 *
 * Assertions:
 *   1. Rejected cancel (already CANCELLED order) → 1 SELECT on orders (no JOIN)
 *      — no query touching order_items or products table
 *   2. Successful cancel (PENDING order) → 2 SELECTs on orders
 *      — first: status check; second: with JOIN to order_items + products
 *
 * Baseline (before B4): 1 SELECT with LEFT JOIN order_items + products even for rejected cancels.
 * After B4: rejected cancel = 1 lightweight SELECT; successful cancel = 2 SELECTs (conditional JOIN).
 *
 * Run: npm run test:perf (from apps/shop/)
 */
import { JwtService } from '@nestjs/jwt';
import {
  bootstrapPerfTest,
  getPgStatStatements,
  PerfTestContext,
  resetPgStatStatements,
  savePerfResults,
  teardownPerfTest,
} from '@test/performance/helpers/bootstrap';
import { IdRow } from '@test/performance/helpers/types';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { seedProducts } from '@/db/perf-seed/generate-products';
import { seedUsers } from '@/db/perf-seed/generate-users';
import { OrderStatus } from '@/orders/order.entity';

let ctx: PerfTestContext;

async function seedOrder(
  ds: DataSource,
  userId: string,
  productId: string,
  status: OrderStatus,
): Promise<string> {
  const [row] = await ds.query<IdRow[]>(
    `INSERT INTO orders (user_id, status) VALUES ($1, $2) RETURNING id`,
    [userId, status],
  );
  await ds.query(
    `INSERT INTO order_items (order_id, product_id, quantity, price_at_purchase) VALUES ($1, $2, 1, '9.99')`,
    [row.id, productId],
  );
  return row.id;
}

describe('[After B4] Order cancel — conditional relation loading', () => {
  let userId: string;
  let productId: string;
  let token: string;

  beforeAll(async () => {
    ctx = await bootstrapPerfTest();
    await seedUsers(ctx.dataSource, 5);
    await seedProducts(ctx.dataSource, 5);

    [{ id: userId }] = await ctx.dataSource.query<IdRow[]>(`SELECT id FROM users LIMIT 1`);
    [{ id: productId }] = await ctx.dataSource.query<IdRow[]>(`SELECT id FROM products LIMIT 1`);

    const jwtService = ctx.app.get(JwtService);
    token = await jwtService.signAsync({
      email: 'perf-user-1@test.local',
      roles: ['user'],
      scopes: ['orders:read', 'orders:write'],
      sub: userId,
    });
  }, 120_000);

  afterAll(() => teardownPerfTest(ctx));

  it('rejected cancel (already CANCELLED): only 1 status-check SELECT, no JOIN to items/products', async () => {
    const orderId = await seedOrder(ctx.dataSource, userId, productId, OrderStatus.CANCELLED);

    await resetPgStatStatements(ctx.dataSource);

    await request(ctx.app.getHttpServer() as unknown as string)
      .post(`/api/v1/orders/${orderId}/cancellation`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);

    const stats = await getPgStatStatements(ctx.dataSource, 'orders');
    const rows = stats.map((s) => ({
      calls: s.calls,
      mean_ms: s.mean_exec_time.toFixed(2),
      query: s.query,
      total_ms: s.total_exec_time.toFixed(2),
    }));
    console.log('[After B4] Queries when cancel is rejected (CANCELLED status):');
    console.table(rows.map((r) => ({ ...r, query: r.query.slice(0, 120) })));
    savePerfResults('order-cancel-rejected-after-b4', rows);

    // After B4: only 1 SELECT on orders (status check) — no JOIN to order_items/products
    expect(stats.length).toBe(1);
    expect(stats[0].query).not.toMatch(/order_items|products/i);
  });

  it('successful cancel (PENDING order): 2 SELECTs — status check + conditional items+products load', async () => {
    const orderId = await seedOrder(ctx.dataSource, userId, productId, OrderStatus.PENDING);

    await resetPgStatStatements(ctx.dataSource);

    await request(ctx.app.getHttpServer() as unknown as string)
      .post(`/api/v1/orders/${orderId}/cancellation`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const stats = await getPgStatStatements(ctx.dataSource, 'orders');
    const rows = stats.map((s) => ({
      calls: s.calls,
      mean_ms: s.mean_exec_time.toFixed(2),
      query: s.query,
      total_ms: s.total_exec_time.toFixed(2),
    }));
    console.log('[After B4] Queries when cancel succeeds (PENDING order):');
    console.table(rows.map((r) => ({ ...r, query: r.query.slice(0, 120) })));
    savePerfResults('order-cancel-success-after-b4', rows);

    // Phase 1: lightweight status SELECT (no JOIN) — same query shape re-used by findByIdWithItemRelations
    // Phase 2: SELECT with LEFT JOIN order_items + products
    // findByIdWithItemRelations: distinctAlias SELECT + main SELECT
    // Total unique SELECT query shapes touching "orders": 4
    const orderSelects = stats.filter((s) => /SELECT.*FROM.*orders/i.test(s.query));
    expect(orderSelects.length).toBe(4);

    // Phase 2 must have fired: a JOIN to order_items/products must exist
    const withJoin = orderSelects.find((s) => /order_items|items/i.test(s.query));
    expect(withJoin).toBeDefined();

    // Phase 1 must have fired: a lightweight SELECT without order_items JOIN must exist
    const withoutJoin = orderSelects.find((s) => !/order_items|items/i.test(s.query));
    expect(withoutJoin).toBeDefined();
  });
});
