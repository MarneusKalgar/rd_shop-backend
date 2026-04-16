/**
 * Perf scenario: order creation
 *
 * Validates A3 optimization: re-fetch inside transaction.
 * Baseline: findByIdWithRelations() is called after INSERT — adds 1 SELECT under lock.
 * After fix: response assembled from in-memory entities — 0 extra SELECT.
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
let testUserId: string;
let testProductId: string;

async function getFirstProductId(ds: DataSource): Promise<string> {
  const [row] = await ds.query<IdRow[]>(
    `SELECT id FROM products WHERE is_active = true AND stock > 5 LIMIT 1`,
  );
  return row.id;
}

async function getFirstUserId(ds: DataSource): Promise<string> {
  const [row] = await ds.query<IdRow[]>(
    `SELECT id FROM users WHERE 'orders:write' = ANY(scopes) LIMIT 1`,
  );
  return row.id;
}

describe('[Perf] Order creation — re-fetch under lock baseline', () => {
  beforeAll(async () => {
    ctx = await bootstrapPerfTest();
    await seedUsers(ctx.dataSource, 10);
    await seedProducts(ctx.dataSource, 20);

    testUserId = await getFirstUserId(ctx.dataSource);
    testProductId = await getFirstProductId(ctx.dataSource);

    // Re-sign token as the test user
    const jwtService = ctx.app.get(JwtService);
    ctx.accessToken = await jwtService.signAsync({
      email: 'perf-user-1@test.local',
      roles: ['user'],
      scopes: ['orders:read', 'orders:write'],
      sub: testUserId,
    });
  }, 120_000);

  afterAll(() => teardownPerfTest(ctx));

  it('establishes baseline: counts DB queries during order creation', async () => {
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

    const orderId: string = (res.body as { data: { id: string } }).data.id;
    console.log(`[Baseline] Created order: ${orderId}`);

    const stats = await getPgStatStatements(ctx.dataSource);
    const rows = stats
      .filter((s) => s.calls > 0)
      .map((s) => ({
        calls: s.calls,
        mean_ms: s.mean_exec_time.toFixed(2),
        query: s.query,
        total_ms: s.total_exec_time.toFixed(2),
      }));
    console.log('[Baseline] Query breakdown during order creation:');
    console.table(rows.map((r) => ({ ...r, query: r.query.slice(0, 100) })));
    savePerfResults('order-creation-baseline', rows);

    // Baseline: expect at least INSERT orders + INSERT order_items + SELECT products (lock) + SELECT after (re-fetch)
    // After A3: no SELECT inside the transaction after INSERTs
    expect(orderId).toBeTruthy();
  });
});
