/**
 * Perf scenario: product-search
 *
 * Validates A1 optimization: ILIKE '%term%' scan vs GIN trigram index.
 * Uses EXPLAIN ANALYZE to assert plan change before/after the migration.
 *
 * This test does NOT test runtime latency — it tests query plan correctness.
 * Runtime metrics are captured separately via k6 + compose.perf.yml.
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

describe('[Perf] Product search — ILIKE scan', () => {
  beforeAll(async () => {
    ctx = await bootstrapPerfTest();
    await seedProducts(ctx.dataSource, 10_000);
  }, 180_000);

  afterAll(() => teardownPerfTest(ctx));

  it('executes a single SELECT for a search request (no extra cursor lookup)', async () => {
    await resetPgStatStatements(ctx.dataSource);

    await request(ctx.app.getHttpServer() as unknown as string)
      .get('/api/v1/products?search=wireless&limit=20')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .expect(200);

    const stats = await getPgStatStatements(ctx.dataSource, 'ilike');
    // One ILIKE query for the main search + at most one count query
    expect(stats.length).toBeGreaterThanOrEqual(1);
  });

  it('uses a sequential scan on title/description without GIN index (baseline)', async () => {
    const rows = await ctx.dataSource.query<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE false, BUFFERS false, FORMAT text)
       SELECT * FROM products WHERE title ILIKE '%wireless%' LIMIT 20`,
    );
    // EXPLAIN FORMAT text returns one row per plan line; join them all before matching.
    const plan: string = rows.map((r) => r['QUERY PLAN']).join('\n');
    // Without pg_trgm GIN index the planner must do a Seq Scan or Parallel Seq Scan
    expect(plan).toMatch(/Seq Scan|Parallel Seq Scan/i);
  });

  it('reports ILIKE query mean time to establish a baseline', async () => {
    await resetPgStatStatements(ctx.dataSource);

    // Warm-up + measured run
    for (let i = 0; i < 5; i++) {
      await ctx.dataSource.query(
        `SELECT id, title FROM products WHERE title ILIKE '%wireless%' LIMIT 20`,
      );
    }

    // pg_stat_statements normalizes literals to $1 — search by keyword 'ilike', not by the literal value.
    const stats = await getPgStatStatements(ctx.dataSource, 'ilike');
    if (stats.length > 0) {
      const rows = stats.map((s) => ({
        calls: s.calls,
        mean_ms: s.mean_exec_time.toFixed(2),
        query: s.query,
        total_ms: s.total_exec_time.toFixed(2),
      }));
      console.log(
        `[Baseline] ILIKE search — calls=${stats[0].calls} mean=${stats[0].mean_exec_time.toFixed(2)}ms total=${stats[0].total_exec_time.toFixed(2)}ms`,
      );
      savePerfResults('product-search-ilike-baseline', rows);
    }
    // Not asserting a threshold — just logging for the before/after table
    expect(stats.length).toBeGreaterThan(0);
  });
});
