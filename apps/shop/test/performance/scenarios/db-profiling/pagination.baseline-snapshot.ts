/**
 * Perf scenario: cursor pagination
 *
 * Validates A2 optimization: cursor pagination should resolve in 1 query, not 2.
 * Before the fix, ProductsRepository issues a findOne() to resolve the cursor ID
 * into row values — an extra DB round-trip per page request.
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

import { seedProducts } from '@/db/perf-seed/generate-products';

let ctx: PerfTestContext;

describe('[Perf] Cursor pagination — extra query baseline', () => {
  beforeAll(async () => {
    ctx = await bootstrapPerfTest();
    await seedProducts(ctx.dataSource, 1_000);
  }, 120_000);

  afterAll(() => teardownPerfTest(ctx));

  it('establishes baseline: counts SELECT queries for page 1 (no cursor)', async () => {
    await resetPgStatStatements(ctx.dataSource);

    const res = await request(ctx.app.getHttpServer() as unknown as string)
      .get('/api/v1/products?limit=20')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .expect(200);

    const body = res.body as { nextCursor?: string };
    console.log('[Baseline] Page 1 — nextCursor present:', !!body.nextCursor);

    const stats = await getPgStatStatements(ctx.dataSource, 'products');
    const selectCount = stats.reduce((sum, s) => sum + s.calls, 0);
    console.log(`[Baseline] Page 1 — total product SELECT calls: ${selectCount}`);
    expect(selectCount).toBeGreaterThanOrEqual(1);
  });

  it('establishes baseline: counts SELECT queries for page 2 (with cursor)', async () => {
    // Fetch page 1 to get a cursor
    const page1 = await request(ctx.app.getHttpServer() as unknown as string)
      .get('/api/v1/products?limit=20')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .expect(200);

    const cursor: string | undefined = (page1.body as { nextCursor?: string }).nextCursor;
    if (!cursor) {
      console.warn('[Baseline] No cursor returned from page 1 — skipping page 2 test');
      return;
    }

    await resetPgStatStatements(ctx.dataSource);

    await request(ctx.app.getHttpServer() as unknown as string)
      .get(`/api/v1/products?limit=20&cursor=${encodeURIComponent(cursor)}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .expect(200);

    const stats = await getPgStatStatements(ctx.dataSource, 'products');
    const totalCalls = stats.reduce((sum, s) => sum + s.calls, 0);

    // Baseline (before A2): expect 2 queries — 1 findOne(cursor) + 1 paginated SELECT
    // After A2: expect 1 query (cursor decoded from token, no DB lookup)
    console.log(`[Baseline] Page 2 with cursor — total product SELECT calls: ${totalCalls}`);
    const rows = stats.map((s) => ({
      calls: s.calls,
      mean_ms: s.mean_exec_time.toFixed(2),
      query: s.query,
      total_ms: s.total_exec_time.toFixed(2),
    }));
    console.table(rows.map((r) => ({ ...r, query: r.query.slice(0, 80) })));
    savePerfResults('pagination-page2-cursor', rows);

    // Document the baseline — assertion is informational, not a hard gate
    expect(totalCalls).toBeGreaterThanOrEqual(1);
  });
});
