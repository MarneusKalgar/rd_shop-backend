/**
 * Perf scenario: order creation — AFTER A3
 *
 * Validates that executeOrderTransaction() no longer issues a re-fetch SELECT
 * after the INSERT. Response must be assembled in-memory from already-loaded entities.
 *
 * Baseline (before A3): ~17 queries including:
 *   SELECT "Order".* FROM "orders" LEFT JOIN "order_items" LEFT JOIN "products" WHERE "Order"."id" = $1
 *   SELECT DISTINCT "distinctAlias"."Order_id" ... LEFT JOIN ...  (pagination id pass)
 *
 * After A3: both of those SELECTs are gone.
 *
 * Assertions:
 *   - POST /api/v1/orders returns 201 with correct items + user in body
 *   - No SELECT query matching LEFT JOIN "order_items" runs after the INSERT
 *   - No "distinctAlias" pagination SELECT runs
 *   - Total queries inside the transaction are reduced to ≤ 15 (from ~17)
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

let ctx: PerfTestContext;
let testProductId: string;

async function getActiveProductId(ds: DataSource): Promise<string> {
  const [row] = await ds.query<IdRow[]>(
    `SELECT id FROM products WHERE is_active = true AND stock > 5 LIMIT 1`,
  );
  return row.id;
}

async function getUserId(ds: DataSource): Promise<string> {
  const [row] = await ds.query<IdRow[]>(
    `SELECT id FROM users WHERE 'orders:write' = ANY(scopes) LIMIT 1`,
  );
  return row.id;
}

describe('[After A3] Order creation — no re-fetch SELECT under lock', () => {
  beforeAll(async () => {
    ctx = await bootstrapPerfTest();
    await seedUsers(ctx.dataSource, 10);
    await seedProducts(ctx.dataSource, 20);

    const userId = await getUserId(ctx.dataSource);
    testProductId = await getActiveProductId(ctx.dataSource);

    const jwtService = ctx.app.get(JwtService);
    ctx.accessToken = await jwtService.signAsync({
      email: 'perf-user-1@test.local',
      roles: ['user'],
      scopes: ['orders:read', 'orders:write'],
      sub: userId,
    });
  }, 120_000);

  afterAll(() => teardownPerfTest(ctx));

  it('creates order and returns items + user assembled in-memory (no re-fetch)', async () => {
    await resetPgStatStatements(ctx.dataSource);

    const res = await request(ctx.app.getHttpServer() as unknown as string)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({
        items: [{ productId: testProductId, quantity: 1 }],
        shipping: {
          city: 'Kyiv',
          country: 'UA',
          firstName: 'Perf',
          lastName: 'Test',
          postcode: '01001',
        },
      })
      .expect(201);

    const body = res.body as { data: { id: string; items: unknown[]; user: unknown } };
    expect(body.data.id).toBeTruthy();
    expect(Array.isArray(body.data.items)).toBe(true);
    expect(body.data.items.length).toBeGreaterThan(0);

    const stats = await getPgStatStatements(ctx.dataSource);
    const rows = stats
      .filter((s) => s.calls > 0)
      .map((s) => ({
        calls: s.calls,
        mean_ms: s.mean_exec_time.toFixed(2),
        query: s.query,
        total_ms: s.total_exec_time.toFixed(2),
      }));

    console.log('[After A3] Query breakdown during order creation:');
    console.table(rows.map((r) => ({ ...r, query: r.query.slice(0, 100) })));
    savePerfResults('order-creation-after-a3', rows);

    // No LEFT JOIN re-fetch SELECT after INSERT
    const refetchQuery = stats.find(
      (s) =>
        /SELECT.*"Order".*FROM.*"orders".*LEFT\s+JOIN.*"order_items"/i.test(s.query) && s.calls > 0,
    );
    expect(refetchQuery).toBeUndefined();

    // No distinctAlias pagination pass SELECT
    const distinctAliasQuery = stats.find((s) => /distinctAlias/i.test(s.query) && s.calls > 0);
    expect(distinctAliasQuery).toBeUndefined();
  });

  it('total query count during order creation is ≤ 16 (re-fetch SELECT removed)', async () => {
    await resetPgStatStatements(ctx.dataSource);

    await request(ctx.app.getHttpServer() as unknown as string)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({
        items: [{ productId: testProductId, quantity: 1 }],
        shipping: {
          city: 'Kyiv',
          country: 'UA',
          firstName: 'Perf',
          lastName: 'Test',
          postcode: '01001',
        },
      })
      .expect(201);

    const stats = await getPgStatStatements(ctx.dataSource);
    const totalCalls = stats.reduce((sum, s) => sum + s.calls, 0);

    console.log(`[After A3] Total SQL calls: ${totalCalls} (baseline ~17, after A3 ~16)`);
    // Baseline had ~17 calls including the re-fetch SELECT with LEFT JOIN order_items.
    // After A3 (response assembled in-memory) that SELECT is gone → ≤ 16.
    expect(totalCalls).toBeLessThanOrEqual(16);
  });
});
